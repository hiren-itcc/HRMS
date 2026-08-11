import type { PayrollReportKind, PayrollReportQuery, ReportColumn } from '@hrms/shared';
import { COMPONENT_CODES } from '@hrms/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { ReportRow } from '../reports/report-export';
import { SettingsService } from '../settings/settings.service';
import { toDays, toMoney } from './payroll.mapper';
import { type PayrollConfig, pfWage } from './payroll.statutory';

/**
 * Payroll reports.
 *
 * Every one is built from the payslips of a single run rather than
 * recalculated, so a report and the payslip it summarises can never disagree.
 * Column shapes match the reports module so `serializeReport` handles the CSV
 * and Excel output unchanged.
 */

export interface PayrollReport {
  title: string;
  month: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, number>;
}

@Injectable()
export class PayrollReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async build(
    orgId: string,
    kind: PayrollReportKind,
    query: PayrollReportQuery,
  ): Promise<PayrollReport> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { organizationId: orgId, month: query.month },
    });
    if (!run) throw new NotFoundException(`No payroll run exists for ${query.month}`);

    const payslips = await this.prisma.payslip.findMany({
      where: {
        runId: run.id,
        ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}),
      },
      include: { lines: true },
      orderBy: { employeeName: 'asc' },
    });

    switch (kind) {
      case 'register':
        return this.register(query.month, payslips);
      case 'bank-transfer':
        return this.bankTransfer(query.month, payslips);
      case 'pf': {
        /*
         * Only PF needs the config, and only for the wage the contribution was
         * levied on. ESI is levied on gross, which the payslip already holds.
         */
        const config = (await this.settings.get(orgId)).payroll;
        return this.statutory(query.month, payslips, 'pf', config);
      }
      case 'esi':
        return this.statutory(query.month, payslips, 'esi');
      case 'tax':
        return this.tax(query.month, payslips);
      case 'department':
        return this.byDepartment(query.month, payslips);
      default:
        throw new BadRequestException(`Unknown report: ${kind}`);
    }
  }

  private lineAmount(
    payslip: { lines: { componentCode: string; amount: unknown }[] },
    code: string,
  ) {
    return toMoney(payslip.lines.find((line) => line.componentCode === code)?.amount ?? 0);
  }

  /** The full salary register — one row per employee, every total. */
  private register(month: string, payslips: PayslipWithLines[]): PayrollReport {
    const columns: ReportColumn[] = [
      { key: 'employeeCode', header: 'Code' },
      { key: 'employeeName', header: 'Employee' },
      { key: 'department', header: 'Department' },
      { key: 'designation', header: 'Designation' },
      { key: 'payableDays', header: 'Payable days', type: 'number' },
      { key: 'lopDays', header: 'LOP days', type: 'number' },
      { key: 'basic', header: 'Basic', type: 'number' },
      { key: 'gross', header: 'Gross', type: 'number' },
      { key: 'pf', header: 'PF', type: 'number' },
      { key: 'esi', header: 'ESI', type: 'number' },
      { key: 'pt', header: 'Prof. tax', type: 'number' },
      { key: 'tds', header: 'TDS', type: 'number' },
      { key: 'deductions', header: 'Total deductions', type: 'number' },
      { key: 'net', header: 'Net pay', type: 'number' },
    ];
    const rows = payslips.map((p) => ({
      employeeCode: p.employeeCode,
      employeeName: p.employeeName,
      department: p.departmentName ?? '—',
      designation: p.designationName ?? '—',
      payableDays: toDays(p.payableDays),
      lopDays: toDays(p.lopDays),
      basic: this.lineAmount(p, COMPONENT_CODES.BASIC),
      gross: toMoney(p.grossEarnings),
      pf: this.lineAmount(p, COMPONENT_CODES.PF),
      esi: this.lineAmount(p, COMPONENT_CODES.ESI),
      pt: this.lineAmount(p, COMPONENT_CODES.PROFESSIONAL_TAX),
      tds: this.lineAmount(p, COMPONENT_CODES.TDS),
      deductions: toMoney(p.totalDeductions),
      net: toMoney(p.netPay),
    }));
    return {
      title: `Salary register — ${month}`,
      month,
      columns,
      rows,
      totals: sumColumns(rows, ['gross', 'pf', 'esi', 'pt', 'tds', 'deductions', 'net']),
    };
  }

  /**
   * The file that actually moves money.
   *
   * Payslips with no bank account are excluded rather than emitted with blank
   * fields — a bank file with a hole in it is worse than a short one, because
   * the hole is discovered by the bank rather than by us.
   */
  private bankTransfer(month: string, payslips: PayslipWithLines[]): PayrollReport {
    const payable = payslips.filter(
      (p) => p.paymentMethod === 'BANK_TRANSFER' && p.accountNumberMasked && toMoney(p.netPay) > 0,
    );
    const columns: ReportColumn[] = [
      { key: 'employeeCode', header: 'Code' },
      { key: 'employeeName', header: 'Beneficiary' },
      { key: 'bankName', header: 'Bank' },
      { key: 'account', header: 'Account' },
      { key: 'ifsc', header: 'IFSC' },
      { key: 'amount', header: 'Amount', type: 'number' },
      { key: 'reference', header: 'Reference' },
    ];
    const rows = payable.map((p) => ({
      employeeCode: p.employeeCode,
      employeeName: p.employeeName,
      bankName: p.bankName ?? '—',
      account: p.accountNumberMasked ?? '—',
      ifsc: p.ifsc ?? '—',
      amount: toMoney(p.netPay),
      reference: `SAL-${month}-${p.employeeCode}`,
    }));
    return {
      title: `Bank transfer — ${month}`,
      month,
      columns,
      rows,
      totals: {
        ...sumColumns(rows, ['amount']),
        excluded: payslips.length - payable.length,
      },
    };
  }

  private statutory(
    month: string,
    payslips: PayslipWithLines[],
    scheme: 'pf' | 'esi',
    config?: PayrollConfig,
  ): PayrollReport {
    const employeeCode = scheme === 'pf' ? COMPONENT_CODES.PF : COMPONENT_CODES.ESI;
    const employerCode =
      scheme === 'pf' ? COMPONENT_CODES.EMPLOYER_PF : COMPONENT_CODES.EMPLOYER_ESI;
    const label = scheme.toUpperCase();

    const rows = payslips
      .map((p) => ({
        employeeCode: p.employeeCode,
        employeeName: p.employeeName,
        /*
         * The wage the contribution was actually taken on, not the full basic.
         *
         * This column used to be the BASIC line outright, which disagreed with
         * the deduction beside it for everybody earning above the ceiling — 22
         * of 26 rows on a seeded month. The deduction was right; the wage was
         * not. `pfWage` is the same function `providentFund` levies with, so
         * the two cannot drift apart again.
         *
         * Known limitation, and it is the reason the fix is not finished here:
         * the ceiling is read from *current* settings, so a report for a month
         * before a statutory ceiling change would show today's cap. The proper
         * answer is freezing the levied wage onto the payslip at calculation
         * time, the way every other figure on it is frozen. Recorded as the
         * follow-up rather than smuggled in behind a bug fix.
         */
        wages:
          scheme === 'pf'
            ? config
              ? pfWage(this.lineAmount(p, COMPONENT_CODES.BASIC), config)
              : this.lineAmount(p, COMPONENT_CODES.BASIC)
            : toMoney(p.grossEarnings),
        employee: this.lineAmount(p, employeeCode),
        employer: this.lineAmount(p, employerCode),
      }))
      // Someone who contributed nothing does not belong on a contribution
      // return — they are not a zero, they are simply not in the scheme.
      .filter((row) => row.employee > 0 || row.employer > 0)
      .map((row) => ({ ...row, total: toMoney(row.employee + row.employer) }));

    return {
      title: `${label} contributions — ${month}`,
      month,
      columns: [
        { key: 'employeeCode', header: 'Code' },
        { key: 'employeeName', header: 'Employee' },
        { key: 'wages', header: scheme === 'pf' ? 'PF wages' : 'ESI wages', type: 'number' },
        { key: 'employee', header: `Employee ${label}` },
        { key: 'employer', header: `Employer ${label}` },
        { key: 'total', header: 'Total', type: 'number' },
      ],
      rows,
      totals: sumColumns(rows, ['wages', 'employee', 'employer', 'total']),
    };
  }

  private tax(month: string, payslips: PayslipWithLines[]): PayrollReport {
    const rows = payslips.map((p) => ({
      employeeCode: p.employeeCode,
      employeeName: p.employeeName,
      gross: toMoney(p.grossEarnings),
      tds: this.lineAmount(p, COMPONENT_CODES.TDS),
      professionalTax: this.lineAmount(p, COMPONENT_CODES.PROFESSIONAL_TAX),
    }));
    return {
      title: `Tax deductions — ${month}`,
      month,
      columns: [
        { key: 'employeeCode', header: 'Code' },
        { key: 'employeeName', header: 'Employee' },
        { key: 'gross', header: 'Gross', type: 'number' },
        { key: 'tds', header: 'TDS', type: 'number' },
        { key: 'professionalTax', header: 'Professional tax', type: 'number' },
      ],
      rows,
      totals: sumColumns(rows, ['gross', 'tds', 'professionalTax']),
    };
  }

  private byDepartment(month: string, payslips: PayslipWithLines[]): PayrollReport {
    const groups = new Map<
      string,
      { headcount: number; gross: number; net: number; employer: number }
    >();
    for (const p of payslips) {
      const key = p.departmentName ?? 'Unassigned';
      const acc = groups.get(key) ?? { headcount: 0, gross: 0, net: 0, employer: 0 };
      acc.headcount += 1;
      acc.gross += toMoney(p.grossEarnings);
      acc.net += toMoney(p.netPay);
      acc.employer += toMoney(p.employerContribution);
      groups.set(key, acc);
    }
    const rows = [...groups.entries()]
      .map(([department, acc]) => ({
        department,
        headcount: acc.headcount,
        gross: toMoney(acc.gross),
        net: toMoney(acc.net),
        employerCost: toMoney(acc.employer),
        // What the department actually costs, which is not the same as what
        // it pays out.
        totalCost: toMoney(acc.gross + acc.employer),
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    return {
      title: `Department payroll — ${month}`,
      month,
      columns: [
        { key: 'department', header: 'Department' },
        { key: 'headcount', header: 'Headcount', type: 'number' },
        { key: 'gross', header: 'Gross', type: 'number' },
        { key: 'net', header: 'Net paid', type: 'number' },
        { key: 'employerCost', header: 'Employer cost', type: 'number' },
        { key: 'totalCost', header: 'Total cost', type: 'number' },
      ],
      rows,
      totals: sumColumns(rows, ['headcount', 'gross', 'net', 'employerCost', 'totalCost']),
    };
  }
}

type PayslipWithLines = {
  employeeCode: string;
  employeeName: string;
  departmentName: string | null;
  designationName: string | null;
  payableDays: unknown;
  lopDays: unknown;
  grossEarnings: unknown;
  totalDeductions: unknown;
  employerContribution: unknown;
  netPay: unknown;
  paymentMethod: string;
  bankName: string | null;
  accountNumberMasked: string | null;
  ifsc: string | null;
  lines: { componentCode: string; amount: unknown }[];
};

function sumColumns(rows: ReportRow[], keys: string[]): Record<string, number> {
  return Object.fromEntries(
    keys.map((key) => [key, toMoney(rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0))]),
  );
}
