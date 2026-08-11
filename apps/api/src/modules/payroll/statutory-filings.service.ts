import { COMPONENT_CODES } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf } from '../../common/utils/calendar';
import { PrismaService } from '../../database/prisma.service';
import { serializeReport } from '../reports/report-export';
import { SettingsService } from '../settings/settings.service';
import { toDays, toMoney } from './payroll.mapper';
import {
  buildEcr,
  buildEsicReturn,
  ESIC_COLUMNS,
  FilingMismatch,
  type FilingRow,
} from './statutory-files';

type Kind = 'ECR' | 'ESIC_RETURN';

/**
 * Statutory returns, built from a published run's frozen payslips.
 *
 * Everything that decides a number lives in `statutory-files.ts`, which has no
 * Prisma in it. This class only fetches, hands over, and freezes the result.
 *
 * **Only a published run.** A draft is still being edited, and a return filed
 * against numbers that then change is worse than no return — the portal has
 * the first version and nothing tells it about the second.
 */
@Injectable()
export class StatutoryFilingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async rowsFor(
    orgId: string,
    month: string,
  ): Promise<{ runId: string; rows: FilingRow[] }> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { organizationId: orgId, month },
    });
    if (!run) throw new NotFoundException(`No payroll run exists for ${month}`);
    if (run.status !== 'PUBLISHED') {
      throw new BadRequestException(
        `The ${month} run is still ${run.status.toLowerCase()}. A return has to be filed against figures that cannot change afterwards.`,
      );
    }

    const payslips = await this.prisma.payslip.findMany({
      where: { runId: run.id },
      include: {
        lines: true,
        employee: { select: { uan: true, esicIpNumber: true, exitDate: true } },
      },
      orderBy: { employeeName: 'asc' },
    });

    const amount = (p: { lines: { componentCode: string; amount: unknown }[] }, code: string) =>
      toMoney(p.lines.find((line) => line.componentCode === code)?.amount ?? 0);

    const rows: FilingRow[] = payslips.map((p) => ({
      employeeCode: p.employeeCode,
      employeeName: p.employeeName,
      uan: p.employee?.uan ?? null,
      esicIpNumber: p.employee?.esicIpNumber ?? null,
      grossWages: toMoney(p.grossEarnings),
      basic: amount(p, COMPONENT_CODES.BASIC),
      employeePf: amount(p, COMPONENT_CODES.PF),
      employerPf: amount(p, COMPONENT_CODES.EMPLOYER_PF),
      employeeEsi: amount(p, COMPONENT_CODES.ESI),
      employerEsi: amount(p, COMPONENT_CODES.EMPLOYER_ESI),
      paidDays: toDays(p.payableDays),
      lopDays: toDays(p.lopDays),
      /*
       * Only a leaver *inside this month* — an exit date last year is not a
       * reason code on this return, it is somebody who is simply not on it.
       */
      lastWorkingDate:
        p.employee?.exitDate && dateKeyOf(p.employee.exitDate).startsWith(month)
          ? dateKeyOf(p.employee.exitDate)
          : null,
    }));

    return { runId: run.id, rows };
  }

  /** What the file would contain, without writing anything. */
  async preview(claims: AccessTokenClaims, kind: Kind, month: string) {
    const { rows } = await this.rowsFor(claims.orgId, month);
    return this.build(claims.orgId, kind, rows);
  }

  private async build(orgId: string, kind: Kind, rows: FilingRow[]) {
    if (kind === 'ESIC_RETURN') {
      const { rows: filed, excluded, totals } = buildEsicReturn(rows);
      return {
        kind,
        rowCount: filed.length,
        excluded,
        totals,
        preview: filed.slice(0, 50),
      };
    }

    const config = (await this.settings.get(orgId)).payroll;
    const result = buildEcr(rows, {
      epsWageCeiling: config.pf.epsWageCeiling,
      epsRate: config.pf.epsRate,
      pfWageCeiling: config.pf.wageCeiling,
      applyPfCeiling: config.pf.applyCeiling,
    });
    return {
      kind,
      rowCount: result.rowCount,
      excluded: result.excluded,
      totals: result.totals,
      preview: result.content.split('\n').slice(0, 50),
    };
  }

  /**
   * Produce the file and freeze it.
   *
   * The unique constraint on (org, kind, period) is what makes regenerating a
   * decision: a second attempt for a month already filed is refused, so
   * correcting somebody's UAN and running it again cannot silently leave two
   * files where a portal has one.
   */
  async generate(claims: AccessTokenClaims, kind: Kind, month: string) {
    const existing = await this.prisma.statutoryFiling.findFirst({
      where: { organizationId: claims.orgId, kind, period: month },
    });
    if (existing) {
      throw new BadRequestException(
        `A ${kind === 'ECR' ? 'ECR' : 'ESIC return'} for ${month} was already generated on ${dateKeyOf(existing.generatedAt)}. Download that one, or delete it first if the payroll has genuinely changed.`,
      );
    }

    const { runId, rows } = await this.rowsFor(claims.orgId, month);

    let built: Awaited<ReturnType<typeof this.build>>;
    try {
      built = await this.build(claims.orgId, kind, rows);
    } catch (err) {
      /*
       * A reconciliation failure is not a 500. It means the return and the
       * payroll behind it disagree, which is a thing an operator can be told
       * and nobody should be handed a file for.
       */
      if (err instanceof FilingMismatch) throw new BadRequestException(err.message);
      throw err;
    }

    const content =
      kind === 'ECR' ? (built.preview as string[]).join('\n') : this.esicCsv(month, rows);

    const filing = await this.prisma.statutoryFiling.create({
      data: {
        organizationId: claims.orgId,
        kind,
        period: month,
        runId,
        content,
        rowCount: built.rowCount,
        excludedCount: built.excluded.length,
        detail: { excluded: built.excluded, totals: built.totals } as object,
        generatedById: claims.sub,
      },
    });

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'payroll.filing.generate',
      'StatutoryFiling',
      filing.id,
      { after: { kind, month, rowCount: built.rowCount, excluded: built.excluded.length } },
    );

    return { id: filing.id, ...built };
  }

  private esicCsv(month: string, rows: FilingRow[]): string {
    const { rows: filed } = buildEsicReturn(rows);
    return serializeReport(
      'csv',
      ESIC_COLUMNS.map((column) => ({ key: column.key, header: column.header })),
      filed,
      `ESIC ${month}`,
    ).body;
  }

  async list(claims: AccessTokenClaims, period?: string) {
    return this.prisma.statutoryFiling.findMany({
      where: { organizationId: claims.orgId, ...(period ? { period } : {}) },
      select: {
        id: true,
        kind: true,
        period: true,
        rowCount: true,
        excludedCount: true,
        generatedAt: true,
      },
      orderBy: { generatedAt: 'desc' },
      take: 50,
    });
  }

  /** The frozen bytes, exactly as generated. Never rebuilt. */
  async file(claims: AccessTokenClaims, id: string) {
    const filing = await this.prisma.statutoryFiling.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!filing) throw new NotFoundException('Filing not found');
    return {
      content: filing.content,
      filename: filing.kind === 'ECR' ? `ecr-${filing.period}.txt` : `esic-${filing.period}.csv`,
      contentType: filing.kind === 'ECR' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8',
    };
  }

  async remove(claims: AccessTokenClaims, id: string) {
    const filing = await this.prisma.statutoryFiling.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!filing) throw new NotFoundException('Filing not found');
    await this.prisma.statutoryFiling.delete({ where: { id } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'payroll.filing.delete',
      'StatutoryFiling',
      id,
      { before: { kind: filing.kind, period: filing.period } },
    );
    return { id };
  }
}
