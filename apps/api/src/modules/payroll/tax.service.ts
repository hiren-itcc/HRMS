import {
  COMPONENT_CODES,
  type TaxDeclarationDecisionInput,
  type TaxDeclarationInput,
  type TaxDeclarationStatusCode,
  type TaxRegimeCode,
  type TdsOverrideInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';
import { calculatePayslip } from './payroll.calc';
import {
  type AnnualTax,
  type ApprovedDeduction,
  calculateAnnualTax,
  calculateEligibleDeduction,
  calculateHraExemption,
  calculateMonthlyTds,
  calculateProjectedIncome,
  calculateRemainingPayrollMonths,
  payrollMonthsRemaining,
  type TaxConfig,
  TaxConfigurationMissing,
  toPaise,
  toRupees,
} from './tax.engine';
import { financialYearOf } from './tds-period';

/**
 * Everything between "which regime did you pick" and "deduct this much this
 * month".
 *
 * The arithmetic is all in `tax.engine.ts` — pure and exhaustively tested. What
 * is here is the data-gathering that feeds it: reading the year's rules,
 * reading what payroll already paid, projecting what it still will, and the
 * declaration workflow around all of it.
 *
 * Two invariants this service exists to hold:
 *
 * **Nothing here ever rewrites a payslip.** Recalculation changes what the
 * *next* run deducts. A December approval leaves April to November exactly as
 * they were, and the already-deducted figure is read from those frozen
 * payslips rather than recomputed.
 *
 * **Form 24Q is downstream and untouched.** It reads actual `PayslipLine` rows
 * with code TDS, as it always has. This module
 * decides what goes *into* that line; it never reaches forward into the return.
 */

const PERSON = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  joinDate: true,
  exitDate: true,
} as const;

export interface TaxSummary {
  financialYear: string;
  regime: TaxRegimeCode;
  month: string;
  declarationStatus: TaxDeclarationStatusCode | null;
  annual: AnnualTax;
  alreadyDeducted: number;
  remainingTax: number;
  remainingMonths: number;
  monthlyTds: number;
  /** Set when somebody overrode this month's figure. */
  override: { overrideTds: number; reason: string } | null;
  /** The month-by-month TDS actually deducted so far this year. */
  history: { month: string; tds: number }[];
}

@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // ── Configuration ───────────────────────────────────────────────────

  /**
   * The year's rules, in the shape the engine wants.
   *
   * Throws rather than falling back to a previous year. Last year's slabs are
   * not this year's, and a silent fallback is how a whole workforce gets
   * deducted against a repealed rate table.
   */
  async configFor(orgId: string, financialYear: string, regime: TaxRegimeCode): Promise<TaxConfig> {
    const row = await this.prisma.taxConfiguration.findUnique({
      where: {
        organizationId_financialYear_regime: { organizationId: orgId, financialYear, regime },
      },
      include: {
        slabs: { orderBy: { order: 'asc' } },
        surchargeBands: { orderBy: { order: 'asc' } },
        deductionRules: { orderBy: { order: 'asc' } },
      },
    });
    if (!row) throw new TaxConfigurationMissing(financialYear, regime);

    return {
      financialYear,
      regime,
      confirmed: row.status === 'CONFIRMED',
      standardDeduction: Number(row.standardDeduction),
      rebateIncomeLimit: row.rebateIncomeLimit === null ? null : Number(row.rebateIncomeLimit),
      rebateMaxAmount: row.rebateMaxAmount === null ? null : Number(row.rebateMaxAmount),
      cessRate: Number(row.cessRate),
      marginalRelief: row.marginalRelief,
      slabs: row.slabs.map((slab) => ({
        fromAmount: Number(slab.fromAmount),
        toAmount: slab.toAmount === null ? null : Number(slab.toAmount),
        rate: Number(slab.rate),
      })),
      surchargeBands: row.surchargeBands.map((band) => ({
        aboveIncome: Number(band.aboveIncome),
        rate: Number(band.rate),
      })),
      deductionRules: row.deductionRules.map((rule) => ({
        section: rule.section,
        maxAmount: rule.maxAmount === null ? null : Number(rule.maxAmount),
      })),
    };
  }

  /** Every configured year, for the settings screen and the year pickers. */
  async configurations(orgId: string, financialYear?: string) {
    const rows = await this.prisma.taxConfiguration.findMany({
      where: { organizationId: orgId, ...(financialYear ? { financialYear } : {}) },
      include: {
        slabs: { orderBy: { order: 'asc' } },
        surchargeBands: { orderBy: { order: 'asc' } },
        deductionRules: { orderBy: { order: 'asc' } },
      },
      orderBy: [{ financialYear: 'desc' }, { regime: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      financialYear: row.financialYear,
      regime: row.regime as TaxRegimeCode,
      status: row.status,
      source: row.source,
      standardDeduction: Number(row.standardDeduction),
      rebateIncomeLimit: row.rebateIncomeLimit === null ? null : Number(row.rebateIncomeLimit),
      rebateMaxAmount: row.rebateMaxAmount === null ? null : Number(row.rebateMaxAmount),
      cessRate: Number(row.cessRate),
      marginalRelief: row.marginalRelief,
      slabs: row.slabs.map((slab) => ({
        fromAmount: Number(slab.fromAmount),
        toAmount: slab.toAmount === null ? null : Number(slab.toAmount),
        rate: Number(slab.rate),
      })),
      surchargeBands: row.surchargeBands.map((band) => ({
        aboveIncome: Number(band.aboveIncome),
        rate: Number(band.rate),
      })),
      deductionRules: row.deductionRules.map((rule) => ({
        section: rule.section,
        label: rule.label,
        hint: rule.hint,
        maxAmount: rule.maxAmount === null ? null : Number(rule.maxAmount),
      })),
    }));
  }

  // ── Regime ──────────────────────────────────────────────────────────

  /**
   * This person's regime for this year, defaulting to NEW.
   *
   * Read-only: it does not create a row. An absent profile *is* the New regime,
   * which is what makes "we never asked them and they are on NEW" and "they
   * chose NEW" the same outcome without a write on every read.
   */
  async regimeFor(employeeId: string, financialYear: string): Promise<TaxRegimeCode> {
    const profile = await this.prisma.employeeTaxProfile.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      select: { regime: true },
    });
    return (profile?.regime ?? 'NEW') as TaxRegimeCode;
  }

  async setRegime(claims: AccessTokenClaims, financialYear: string, regime: TaxRegimeCode) {
    const employeeId = this.requireEmployee(claims);
    const previous = await this.regimeFor(employeeId, financialYear);

    const row = await this.prisma.employeeTaxProfile.upsert({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      create: { organizationId: claims.orgId, employeeId, financialYear, regime },
      update: { regime },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      previous === regime ? 'tax.regime.select' : 'tax.regime.change',
      'EmployeeTaxProfile',
      row.id,
      { before: { regime: previous }, after: { regime, financialYear } },
    );
    return { financialYear, regime };
  }

  // ── Declarations ────────────────────────────────────────────────────

  async declarationFor(orgId: string, employeeId: string, financialYear: string) {
    const row = await this.prisma.employeeTaxDeclaration.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      include: { items: true },
    });
    if (!row || row.organizationId !== orgId) return null;
    return this.mapDeclaration(row);
  }

  private mapDeclaration(row: {
    id: string;
    employeeId: string;
    financialYear: string;
    status: string;
    annualRentPaid: unknown;
    metroCity: boolean;
    submittedAt: Date | null;
    decidedAt: Date | null;
    decisionNote: string | null;
    revision: number;
    items: {
      section: string;
      declaredAmount: unknown;
      statutoryLimit: unknown;
      eligibleAmount: unknown;
      approvedAmount: unknown;
    }[];
  }) {
    return {
      id: row.id,
      employeeId: row.employeeId,
      financialYear: row.financialYear,
      status: row.status as TaxDeclarationStatusCode,
      annualRentPaid: row.annualRentPaid === null ? null : Number(row.annualRentPaid),
      metroCity: row.metroCity,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
      revision: row.revision,
      items: row.items.map((item) => ({
        section: item.section,
        declaredAmount: Number(item.declaredAmount),
        statutoryLimit: item.statutoryLimit === null ? null : Number(item.statutoryLimit),
        eligibleAmount: Number(item.eligibleAmount),
        approvedAmount: Number(item.approvedAmount),
      })),
    };
  }

  /**
   * Save a declaration, replacing its lines wholesale.
   *
   * Only a draft or a sent-back declaration is editable. Editing an approved
   * one bumps `revision` and drops it back to DRAFT — an approval is a
   * statement about a specific set of figures, and changing them silently
   * would leave HR having agreed something nobody can now see.
   */
  async saveDeclaration(claims: AccessTokenClaims, input: TaxDeclarationInput) {
    const employeeId = this.requireEmployee(claims);
    const regime = await this.regimeFor(employeeId, input.financialYear);
    if (regime !== 'OLD') {
      throw new BadRequestException(
        'The New regime needs no declaration. Switch to the Old regime first if you want to claim deductions.',
      );
    }

    const config = await this.configFor(claims.orgId, input.financialYear, 'OLD');
    const allowed = new Map(config.deductionRules.map((rule) => [rule.section, rule]));
    const unknown = input.items.filter((item) => !allowed.has(item.section));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `${unknown.map((item) => item.section).join(', ')} cannot be claimed in ${input.financialYear}`,
      );
    }

    const existing = await this.prisma.employeeTaxDeclaration.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear: input.financialYear } },
      select: { id: true, status: true, revision: true },
    });
    if (existing?.status === 'SUBMITTED') {
      throw new BadRequestException('This is with HR — it cannot be edited until they respond');
    }

    const items = input.items.map((item) => {
      const limit = allowed.get(item.section)?.maxAmount ?? null;
      const eligible = calculateEligibleDeduction(item.declaredAmount, limit);
      return {
        section: item.section,
        declaredAmount: item.declaredAmount,
        statutoryLimit: limit,
        eligibleAmount: eligible,
        // Nothing is approved until HR says so; the figure the engine reads
        // stays zero until then.
        approvedAmount: 0,
      };
    });

    const row = await this.prisma.employeeTaxDeclaration.upsert({
      where: { employeeId_financialYear: { employeeId, financialYear: input.financialYear } },
      create: {
        organizationId: claims.orgId,
        employeeId,
        financialYear: input.financialYear,
        annualRentPaid: input.annualRentPaid ?? null,
        metroCity: input.metroCity,
        items: { create: items },
      },
      update: {
        status: 'DRAFT',
        annualRentPaid: input.annualRentPaid ?? null,
        metroCity: input.metroCity,
        decisionNote: existing?.status === 'REJECTED' ? undefined : null,
        revision: existing?.status === 'APPROVED' ? { increment: 1 } : undefined,
        items: { deleteMany: {}, create: items },
      },
      include: { items: true },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      existing?.status === 'APPROVED' ? 'tax.declaration.revise' : 'tax.declaration.save',
      'EmployeeTaxDeclaration',
      row.id,
      { after: { financialYear: input.financialYear, sections: items.length } },
    );
    return this.mapDeclaration(row);
  }

  async submitDeclaration(claims: AccessTokenClaims, financialYear: string) {
    const employeeId = this.requireEmployee(claims);
    const row = await this.prisma.employeeTaxDeclaration.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      include: { items: true },
    });
    if (!row) throw new NotFoundException('There is no declaration to submit');
    if (row.status === 'SUBMITTED') throw new BadRequestException('This is already with HR');
    if (row.status === 'APPROVED') {
      throw new BadRequestException('This was approved — edit it first if it needs changing');
    }
    if (row.items.length === 0 && row.annualRentPaid === null) {
      throw new BadRequestException('Declare something before submitting');
    }

    const updated = await this.prisma.employeeTaxDeclaration.update({
      where: { id: row.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
      include: { items: true },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'tax.declaration.submit',
      'EmployeeTaxDeclaration',
      row.id,
      { after: { financialYear } },
    );
    return this.mapDeclaration(updated);
  }

  /**
   * HR's answer.
   *
   * Approval is where `approvedAmount` is finally written — capped again
   * against the statutory limit, because HR trimming a figure is a reason to
   * lower it and never a reason to exceed the cap.
   */
  async decideDeclaration(
    claims: AccessTokenClaims,
    employeeId: string,
    financialYear: string,
    decision: 'APPROVED' | 'REJECTED',
    input: TaxDeclarationDecisionInput,
  ) {
    const row = await this.prisma.employeeTaxDeclaration.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      include: { items: true },
    });
    if (!row || row.organizationId !== claims.orgId) {
      throw new NotFoundException('Declaration not found');
    }
    if (row.status !== 'SUBMITTED') {
      throw new BadRequestException(
        row.status === 'DRAFT'
          ? 'This has not been submitted yet'
          : `This was already ${row.status.toLowerCase()}`,
      );
    }
    if (decision === 'REJECTED' && !input.note?.trim()) {
      throw new BadRequestException('Say what needs changing before sending a declaration back');
    }
    if (row.employeeId === claims.employeeId) {
      throw new ForbiddenException('You cannot approve your own declaration');
    }

    if (decision === 'APPROVED') {
      const overrides = new Map<string, number>(
        (input.approved ?? []).map((item) => [item.section as string, item.approvedAmount]),
      );
      for (const item of row.items) {
        const limit = item.statutoryLimit === null ? null : Number(item.statutoryLimit);
        const wanted = overrides.get(item.section) ?? Number(item.declaredAmount);
        await this.prisma.employeeTaxDeclarationItem.update({
          where: { id: item.id },
          data: { approvedAmount: calculateEligibleDeduction(wanted, limit) },
        });
      }
    }

    const updated = await this.prisma.employeeTaxDeclaration.update({
      where: { id: row.id },
      data: {
        status: decision,
        decidedById: claims.sub,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      },
      include: { items: true },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      `tax.declaration.${decision.toLowerCase()}`,
      'EmployeeTaxDeclaration',
      row.id,
      { after: { financialYear, note: input.note ?? null } },
    );
    return this.mapDeclaration(updated);
  }

  // ── The projection ──────────────────────────────────────────────────

  /**
   * Everything about one person's tax for one year, as of one payroll month.
   *
   * The `month` argument is what makes this answerable rather than a moving
   * target: the same call for April always says twelve remaining months,
   * whatever today is.
   */
  async summaryFor(
    orgId: string,
    employeeId: string,
    financialYear: string,
    month: string,
  ): Promise<TaxSummary> {
    const regime = await this.regimeFor(employeeId, financialYear);
    const config = await this.configFor(orgId, financialYear, regime);
    const context = await this.gather(orgId, [employeeId], financialYear, month);
    return this.summarise(employeeId, financialYear, month, regime, config, context);
  }

  /**
   * One round of queries for a whole payroll run.
   *
   * Batched rather than per employee: a run of 500 people would otherwise be
   * 2,500 queries, which is the N+1 the WFH module had to have removed after it
   * shipped.
   */
  private async gather(orgId: string, employeeIds: string[], financialYear: string, month: string) {
    const yearMonths = payrollMonthsRemaining(`${financialYear.slice(0, 4)}-04`);
    const settings = await this.settings.get(orgId);

    const [employees, salaries, payslips, declarations, overrides, components] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: employeeIds }, organizationId: orgId },
        select: PERSON,
      }),
      this.prisma.employeeSalary.findMany({
        where: { employeeId: { in: employeeIds } },
        include: { structure: { include: { lines: { include: { component: true } } } } },
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.prisma.payslip.findMany({
        where: {
          employeeId: { in: employeeIds },
          run: { organizationId: orgId, month: { in: yearMonths }, status: 'PUBLISHED' },
        },
        select: {
          employeeId: true,
          grossEarnings: true,
          run: { select: { month: true } },
          lines: { select: { componentCode: true, kind: true, amount: true } },
        },
      }),
      this.prisma.employeeTaxDeclaration.findMany({
        where: { employeeId: { in: employeeIds }, financialYear, status: 'APPROVED' },
        include: { items: true },
      }),
      this.prisma.tdsOverride.findMany({
        where: { employeeId: { in: employeeIds }, month },
      }),
      this.prisma.payComponent.findMany({
        where: { organizationId: orgId },
        select: { code: true, taxable: true, kind: true },
      }),
    ]);

    return {
      settings,
      employees: new Map(employees.map((row) => [row.id, row])),
      salaries,
      payslips,
      declarations: new Map(declarations.map((row) => [row.employeeId, row])),
      overrides: new Map(overrides.map((row) => [row.employeeId, row])),
      taxableCodes: new Set(components.filter((c) => c.taxable).map((c) => c.code)),
    };
  }

  private summarise(
    employeeId: string,
    financialYear: string,
    month: string,
    regime: TaxRegimeCode,
    config: TaxConfig,
    context: Awaited<ReturnType<TaxService['gather']>>,
  ): TaxSummary {
    const employee = context.employees.get(employeeId);
    const joinMonth = employee?.joinDate ? employee.joinDate.toISOString().slice(0, 7) : null;
    const exitMonth = employee?.exitDate ? employee.exitDate.toISOString().slice(0, 7) : null;

    // What already happened, read from frozen payslips and never re-derived.
    const mine = context.payslips.filter((slip) => slip.employeeId === employeeId);
    const earned = mine.map((slip) => ({
      month: slip.run.month,
      taxableGross: this.taxableGrossOf(slip.lines, context.taxableCodes),
    }));
    const alreadyDeducted = toRupees(
      mine.reduce(
        (sum, slip) =>
          sum +
          toPaise(
            Number(
              slip.lines.find((line) => line.componentCode === COMPONENT_CODES.TDS)?.amount ?? 0,
            ),
          ),
        0,
      ),
    );
    const history = mine
      .map((slip) => ({
        month: slip.run.month,
        tds: Number(
          slip.lines.find((line) => line.componentCode === COMPONENT_CODES.TDS)?.amount ?? 0,
        ),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // What is still to come, projected through the same function that will
    // actually compute those payslips.
    const paidMonths = new Set(earned.map((row) => row.month));
    const remainingMonths = payrollMonthsRemaining(month, { joinMonth, exitMonth }).filter(
      (key) => !paidMonths.has(key),
    );
    const salary = context.salaries.find((row) => row.employeeId === employeeId);
    const projectedMonth = salary ? this.projectMonth(salary, month, context.settings) : null;

    const projectedIncome = calculateProjectedIncome({
      earned,
      projectedMonthly: projectedMonth?.taxableGross ?? 0,
      remainingMonths,
    });

    // HRA exemption needs the whole year's basic and HRA, earned plus projected.
    const declaration = context.declarations.get(employeeId);
    const annualBasic = this.annualComponent(
      COMPONENT_CODES.BASIC,
      mine,
      projectedMonth,
      remainingMonths.length,
    );
    const annualHra = this.annualComponent('HRA', mine, projectedMonth, remainingMonths.length);
    const exemptions =
      regime === 'OLD' && declaration?.annualRentPaid
        ? calculateHraExemption({
            annualBasic,
            annualHraReceived: annualHra,
            annualRentPaid: Number(declaration.annualRentPaid),
            metroCity: declaration.metroCity,
          })
        : 0;

    const approvedDeductions: ApprovedDeduction[] =
      regime === 'OLD' && declaration
        ? declaration.items.map((item) => ({
            section: item.section,
            approvedAmount: Number(item.approvedAmount),
          }))
        : [];

    const annual = calculateAnnualTax({
      projectedIncome,
      exemptions,
      approvedDeductions,
      config,
    });

    const tds = calculateMonthlyTds({
      annualTaxLiability: annual.annualTaxLiability,
      alreadyDeducted,
      remainingMonths: remainingMonths.length || calculateRemainingPayrollMonths(month),
    });

    const override = context.overrides.get(employeeId);

    return {
      financialYear,
      regime,
      month,
      declarationStatus: (declaration?.status as TaxDeclarationStatusCode) ?? null,
      annual,
      alreadyDeducted,
      remainingTax: tds.remainingTax,
      remainingMonths: tds.remainingMonths,
      monthlyTds: override ? Number(override.overrideTds) : tds.monthlyTds,
      override: override
        ? { overrideTds: Number(override.overrideTds), reason: override.reason }
        : null,
      history,
    };
  }

  private taxableGrossOf(
    lines: { componentCode: string; kind: string; amount: unknown }[],
    taxableCodes: ReadonlySet<string>,
  ): number {
    return toRupees(
      lines.reduce(
        (sum, line) =>
          line.kind === 'EARNING' && taxableCodes.has(line.componentCode)
            ? sum + toPaise(Number(line.amount))
            : sum,
        0,
      ),
    );
  }

  /**
   * A future month's payslip, computed by the payroll engine itself.
   *
   * Reusing `calculatePayslip` rather than re-deriving the structure is what
   * makes the projection agree with the payslip when it eventually lands. LOP
   * is deliberately not projected: nobody knows next month's unpaid leave, and
   * assuming none is the honest default.
   */
  private projectMonth(
    salary: {
      monthlyCtc: unknown;
      structure: {
        lines: {
          calcType: string;
          value: unknown;
          component: { code: string; name: string; kind: string; taxable: boolean };
        }[];
      };
    },
    month: string,
    settings: { payroll: unknown },
  ) {
    const calc = calculatePayslip({
      month,
      monthlyCtc: Number(salary.monthlyCtc),
      lines: salary.structure.lines.map((line) => ({
        code: line.component.code,
        name: line.component.name,
        kind: line.component.kind as 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION',
        calcType: line.calcType as
          | 'FLAT'
          | 'PERCENT_OF_BASIC'
          | 'PERCENT_OF_CTC'
          | 'STATUTORY'
          | 'BALANCE',
        value: Number(line.value),
        order: 0,
      })),
      // biome-ignore lint/suspicious/noExplicitAny: PayrollConfig comes from settings
      config: (settings as any).payroll,
    });

    const taxableCodes = new Set(
      salary.structure.lines
        .filter((line) => line.component.taxable)
        .map((line) => line.component.code),
    );
    return {
      taxableGross: this.taxableGrossOf(
        calc.lines.map((line) => ({
          componentCode: line.code,
          kind: line.kind,
          amount: line.amount,
        })),
        taxableCodes,
      ),
      byCode: new Map(calc.lines.map((line) => [line.code, line.amount])),
    };
  }

  /** A component's whole-year total: what was paid, plus what is projected. */
  private annualComponent(
    code: string,
    paid: { lines: { componentCode: string; amount: unknown }[] }[],
    projected: { byCode: Map<string, number> } | null,
    remainingMonths: number,
  ): number {
    const earned = paid.reduce(
      (sum, slip) =>
        sum + toPaise(Number(slip.lines.find((line) => line.componentCode === code)?.amount ?? 0)),
      0,
    );
    const future = toPaise(projected?.byCode.get(code) ?? 0) * remainingMonths;
    return toRupees(earned + future);
  }

  // ── Payroll integration ─────────────────────────────────────────────

  /**
   * The TDS figure for every employee in a run, in one pass.
   *
   * Called by `PayrollRunsService.calculate`. An employee whose year has no
   * confirmed configuration is **skipped rather than zeroed** — a zero would
   * look like "no tax due" on the payslip, and the run reports the skip instead.
   */
  async tdsForRun(
    orgId: string,
    month: string,
    employeeIds: string[],
  ): Promise<{ tds: Map<string, number>; unconfigured: string[] }> {
    const tds = new Map<string, number>();
    const unconfigured: string[] = [];
    if (employeeIds.length === 0) return { tds, unconfigured };

    const financialYear = financialYearOf(month);
    const [context, profiles] = await Promise.all([
      this.gather(orgId, employeeIds, financialYear, month),
      this.prisma.employeeTaxProfile.findMany({
        where: { employeeId: { in: employeeIds }, financialYear },
        select: { employeeId: true, regime: true },
      }),
    ]);
    const regimeOf = new Map(profiles.map((row) => [row.employeeId, row.regime as TaxRegimeCode]));

    const configs = new Map<TaxRegimeCode, TaxConfig | null>();
    for (const regime of ['NEW', 'OLD'] as const) {
      configs.set(regime, await this.configFor(orgId, financialYear, regime).catch(() => null));
    }

    for (const employeeId of employeeIds) {
      const regime = regimeOf.get(employeeId) ?? 'NEW';
      const config = configs.get(regime);
      if (!config?.confirmed) {
        unconfigured.push(employeeId);
        continue;
      }
      const summary = this.summarise(employeeId, financialYear, month, regime, config, context);
      tds.set(employeeId, summary.monthlyTds);
    }
    return { tds, unconfigured };
  }

  // ── Override ────────────────────────────────────────────────────────

  /**
   * A deliberate exception, recorded beside the figure it replaces.
   *
   * The calculated amount is stored on the row rather than discarded: an
   * override whose original is lost is an override nobody can audit.
   */
  async overrideTds(claims: AccessTokenClaims, employeeId: string, input: TdsOverrideInput) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: claims.orgId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const financialYear = financialYearOf(input.month);
    const summary = await this.summaryFor(claims.orgId, employeeId, financialYear, input.month);

    const row = await this.prisma.tdsOverride.upsert({
      where: { employeeId_month: { employeeId, month: input.month } },
      create: {
        organizationId: claims.orgId,
        employeeId,
        month: input.month,
        calculatedTds: summary.override ? summary.monthlyTds : summary.monthlyTds,
        overrideTds: input.overrideTds,
        reason: input.reason,
        createdById: claims.sub,
      },
      update: { overrideTds: input.overrideTds, reason: input.reason, createdById: claims.sub },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'tax.tds.override',
      'TdsOverride',
      row.id,
      {
        before: { calculatedTds: Number(row.calculatedTds) },
        after: { overrideTds: input.overrideTds, month: input.month, reason: input.reason },
      },
    );
    return {
      month: row.month,
      calculatedTds: Number(row.calculatedTds),
      overrideTds: Number(row.overrideTds),
      reason: row.reason,
    };
  }

  async clearOverride(claims: AccessTokenClaims, employeeId: string, month: string) {
    const row = await this.prisma.tdsOverride.findFirst({
      where: { employeeId, month, organizationId: claims.orgId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('No override on that month');
    await this.prisma.tdsOverride.delete({ where: { id: row.id } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'tax.tds.override.clear',
      'TdsOverride',
      row.id,
      { before: { month } },
    );
    return { id: row.id };
  }

  // ── HR listing ──────────────────────────────────────────────────────

  /** Everybody's tax position for a year, for the HR dashboard. */
  async listEmployees(
    orgId: string,
    financialYear: string,
    month: string,
    filters: {
      regime?: TaxRegimeCode;
      status?: TaxDeclarationStatusCode;
      departmentId?: string;
      search?: string;
    } = {},
  ) {
    const where: Prisma.EmployeeWhereInput = {
      organizationId: orgId,
      status: { not: 'EXITED' },
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.search
        ? {
            OR: [
              { firstName: { contains: filters.search, mode: 'insensitive' } },
              { lastName: { contains: filters.search, mode: 'insensitive' } },
              { employeeCode: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const employees = await this.prisma.employee.findMany({
      where,
      select: { ...PERSON, department: { select: { name: true } } },
      orderBy: [{ firstName: 'asc' }],
    });
    if (employees.length === 0) return [];

    const ids = employees.map((row) => row.id);
    const [context, profiles] = await Promise.all([
      this.gather(orgId, ids, financialYear, month),
      this.prisma.employeeTaxProfile.findMany({
        where: { employeeId: { in: ids }, financialYear },
        select: { employeeId: true, regime: true },
      }),
    ]);
    const regimeOf = new Map(profiles.map((row) => [row.employeeId, row.regime as TaxRegimeCode]));

    const configs = new Map<TaxRegimeCode, TaxConfig | null>();
    for (const regime of ['NEW', 'OLD'] as const) {
      configs.set(regime, await this.configFor(orgId, financialYear, regime).catch(() => null));
    }

    const rows = [];
    for (const employee of employees) {
      const regime = regimeOf.get(employee.id) ?? 'NEW';
      if (filters.regime && regime !== filters.regime) continue;
      const config = configs.get(regime);
      const declaration = context.declarations.get(employee.id);
      const status = (declaration?.status as TaxDeclarationStatusCode) ?? null;
      if (filters.status && status !== filters.status) continue;

      const summary = config?.confirmed
        ? this.summarise(employee.id, financialYear, month, regime, config, context)
        : null;

      rows.push({
        employeeId: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeCode: employee.employeeCode,
        department: employee.department?.name ?? null,
        financialYear,
        regime,
        declarationStatus: status,
        // Null rather than zero when the year is unconfirmed: "no rules yet"
        // and "no tax due" must not render the same.
        projectedTaxableIncome: summary?.annual.projectedTaxableIncome ?? null,
        annualTax: summary?.annual.annualTaxLiability ?? null,
        alreadyDeducted: summary?.alreadyDeducted ?? null,
        remainingTax: summary?.remainingTax ?? null,
        monthlyTds: summary?.monthlyTds ?? null,
        overridden: summary?.override !== null && summary?.override !== undefined,
      });
    }
    return rows;
  }

  /** Declarations awaiting HR, which is the queue the approvals screen works. */
  async pendingDeclarations(orgId: string, financialYear: string) {
    const rows = await this.prisma.employeeTaxDeclaration.findMany({
      where: { organizationId: orgId, financialYear, status: 'SUBMITTED' },
      include: { items: true, employee: { select: PERSON } },
      orderBy: { submittedAt: 'asc' },
    });
    return rows.map((row) => ({
      ...this.mapDeclaration(row),
      employee: {
        id: row.employee.id,
        firstName: row.employee.firstName,
        lastName: row.employee.lastName,
        employeeCode: row.employee.employeeCode,
      },
    }));
  }

  private requireEmployee(claims: AccessTokenClaims): string {
    if (!claims.employeeId) {
      throw new BadRequestException('No employee record is linked to this account');
    }
    return claims.employeeId;
  }
}
