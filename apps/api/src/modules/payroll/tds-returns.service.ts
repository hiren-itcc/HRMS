import { COMPONENT_CODES, type OrgSettings } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { toDateKey, toMoney } from './payroll.mapper';
import { build24Q, type ChallanEntry, type Deductee, LAYOUT_TRANSCRIBED } from './tds-files';
import { monthsIn, type TdsQuarterCode } from './tds-period';
import { reconcile } from './tds-reconcile';

export interface TdsReadiness {
  /**
   * Non-null when the *data* is not fit to file — settings missing, a month
   * unpublished, or challans disagreeing with payroll.
   */
  blocked: string | null;
  /**
   * Non-null while the record layout has not been transcribed.
   *
   * Deliberately a separate field from `blocked`, and deliberately not an
   * early return. Folding it into `blocked` and checking it first would mask
   * every substantive check behind it: an operator whose challans disagree
   * with payroll by thousands would see only "the layout is missing" and
   * never learn their numbers are wrong. The reconciliation is the part of
   * this feature that works today; hiding it behind the part that does not
   * would be exactly backwards.
   */
  layoutBlocked: string | null;
  /** Real problems that must not stop a statutory deadline being met. */
  warnings: string[];
  months: string[];
}

/**
 * Form 24Q, built from the frozen payslips of published runs.
 *
 * Everything that decides a number lives in `tds-files.ts` and
 * `tds-reconcile.ts`, neither of which imports Prisma. This class fetches,
 * hands over, and freezes.
 *
 * **Published runs only**, the same rule `StatutoryFilingsService` enforces
 * monthly — a return filed against numbers that then change is worse than no
 * return, because the portal has the first version and nothing tells it about
 * the second.
 */
@Injectable()
export class TdsReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async gather(orgId: string, financialYear: string, quarter: TdsQuarterCode) {
    const months = monthsIn(financialYear, quarter);

    const runs = await this.prisma.payrollRun.findMany({
      where: { organizationId: orgId, month: { in: months } },
      select: { id: true, month: true, status: true },
    });

    const published = runs.filter((run) => run.status === 'PUBLISHED');
    const payslips = published.length
      ? await this.prisma.payslip.findMany({
          where: { runId: { in: published.map((run) => run.id) } },
          include: { lines: true, employee: { select: { pan: true } } },
          orderBy: { employeeName: 'asc' },
        })
      : [];

    const challans = await this.prisma.tdsChallan.findMany({
      where: { organizationId: orgId, period: { in: months } },
    });

    const runMonth = new Map(published.map((run) => [run.id, run.month]));
    const deductees: Record<string, Deductee[]> = Object.fromEntries(
      months.map((month) => [month, [] as Deductee[]]),
    );

    for (const slip of payslips) {
      const month = runMonth.get(slip.runId);
      if (!month) continue;
      const tds = toMoney(
        slip.lines.find((line) => line.componentCode === COMPONENT_CODES.TDS)?.amount ?? 0,
      );
      // Somebody who had nothing deducted is not a deductee and does not
      // belong on the return at all.
      if (tds <= 0) continue;
      deductees[month]?.push({
        employeeCode: slip.employeeCode,
        employeeName: slip.employeeName,
        pan: slip.employee?.pan ?? null,
        tdsDeducted: tds,
        grossSalary: toMoney(slip.grossEarnings),
      });
    }

    const challanByMonth = new Map(challans.map((row) => [row.period, row]));
    const entries: ChallanEntry[] = challans.map((row) => ({
      month: row.period,
      bsrCode: row.bsrCode,
      challanSerial: row.challanSerial,
      // `toDateKey`, not `.toISOString()` / `dateKeyOf`. Prisma hands this
      // back as a Date from a live query and as a string from a mocked one,
      // and `tds-challans.service.ts` already reaches for this helper at
      // exactly this seam for the same field.
      depositDate: toDateKey(row.depositDate) as string,
      tds: toMoney(row.tds),
      surcharge: toMoney(row.surcharge),
      educationCess: toMoney(row.educationCess),
      interest: toMoney(row.interest),
      fee: toMoney(row.fee),
      penalty: toMoney(row.penalty),
      others: toMoney(row.others),
    }));

    return { months, runs, published, deductees, challanByMonth, entries };
  }

  async readiness(
    claims: AccessTokenClaims,
    financialYear: string,
    quarter: TdsQuarterCode,
  ): Promise<TdsReadiness> {
    const statutory = (await this.settings.get(claims.orgId)).statutory;
    const gathered = await this.gather(claims.orgId, financialYear, quarter);
    return this.evaluate(statutory, gathered, quarter);
  }

  /**
   * The decision half of `readiness()`, split out so `generate()` can gather
   * once and evaluate that single snapshot instead of re-querying. Contains
   * no queries — everything it needs arrives as arguments.
   */
  private evaluate(
    statutory: OrgSettings['statutory'],
    gathered: Awaited<ReturnType<TdsReturnsService['gather']>>,
    quarter: TdsQuarterCode,
  ): TdsReadiness {
    const { months, runs, deductees, challanByMonth } = gathered;

    /*
     * Computed, not returned early. Producing a *file* needs the layout;
     * checking the data does not. Returning here would hide a reconciliation
     * failure behind a message about a missing specification, and the
     * reconciliation is the half of this feature that works today.
     */
    const layoutBlocked = LAYOUT_TRANSCRIBED
      ? null
      : 'The Form 24Q record layout has not been transcribed from the published File Format specification yet, so no file can be generated. Recording challans and reconciling them against payroll both still work.';

    const missing = [
      !statutory.tan && 'TAN',
      !statutory.pan && "the company's PAN",
      !statutory.signatoryName && 'a responsible person',
    ].filter(Boolean);
    if (missing.length) {
      return {
        blocked: `No ${missing.join(', ')} on record. Add ${missing.length === 1 ? 'it' : 'them'} in Settings → Statutory before generating a 24Q.`,
        layoutBlocked,
        warnings: [],
        months,
      };
    }

    /*
     * Grouped by month rather than `new Map(runs.map((run) => [run.month,
     * run.status]))`, which keeps whichever row the query happened to return
     * last — a month holding both a DRAFT and a PUBLISHED run would then
     * report one status arbitrarily. A month counts as published only if
     * every run recorded against it is PUBLISHED.
     */
    const statusesByMonth = new Map<string, string[]>();
    for (const run of runs) {
      statusesByMonth.set(run.month, [...(statusesByMonth.get(run.month) ?? []), run.status]);
    }
    const missingRun = months.filter((month) => !statusesByMonth.has(month));
    const unpublished = months.filter((month) => {
      const statuses = statusesByMonth.get(month);
      return statuses !== undefined && !statuses.every((status) => status === 'PUBLISHED');
    });
    if (missingRun.length || unpublished.length) {
      /*
       * Both refuse, and they are reported apart because the fix differs: one
       * wants a payroll run, the other wants the run published. This mirrors
       * `StatutoryFilingsService.rowsFor`, which throws NotFound for the first
       * and BadRequest for the second rather than letting either through.
       */
      const parts = [
        missingRun.length > 0 &&
          `${missingRun.join(', ')} ${missingRun.length === 1 ? 'has' : 'have'} no payroll run at all`,
        unpublished.length > 0 &&
          `${unpublished.join(', ')} ${unpublished.length === 1 ? 'is' : 'are'} still unpublished`,
      ].filter(Boolean);
      return {
        blocked: `${parts.join('; ')}. Every month in the quarter has to be published before it can be filed — a return that omits a month is a short one, and the department has no way to know.`,
        layoutBlocked,
        warnings: [],
        months,
      };
    }

    /*
     * `reconcile` throws, rather than returning an unbalanced result, on a
     * non-finite (NaN) amount — see its own comment. Deliberately not caught
     * here: a NaN means an upstream Decimal-to-number conversion already
     * broke, which is a bug to surface as a 500, not a money disagreement to
     * reword as "the challans and payslips disagree" — that would misdescribe
     * corrupt input as a mere deposit mismatch, the opposite of what this
     * gate exists to report honestly. Letting it propagate does not repeat
     * the "every 500 was unattributable" defect docs/15-feature-audit.md
     * names: `HttpExceptionFilter` now logs every 500 with its stack and the
     * request that triggered it before returning the client its opaque
     * message, so this is an attributable 500, not a silent one.
     */
    const result = reconcile(
      months.map((month) => ({
        month,
        payslipTds: (deductees[month] ?? []).reduce((sum, d) => sum + d.tdsDeducted, 0),
        challanTds: challanByMonth.has(month) ? toMoney(challanByMonth.get(month)?.tds) : null,
      })),
    );

    if (result.missingChallans.length) {
      return {
        blocked: `TDS was deducted in ${result.missingChallans.join(', ')} but no challan is recorded. Add the deposit before filing — a return names the challan every deductee was paid under.`,
        layoutBlocked,
        warnings: [],
        months,
      };
    }

    if (result.differences.length) {
      const detail = result.differences
        .map(
          (d) =>
            `${d.month} deducted ${d.payslipTds} and deposited ${d.challanTds}, a difference of ${d.difference}`,
        )
        .join('; ');
      return {
        blocked: `The challans and the payslips disagree: ${detail}. Fix one or the other before filing — a 24Q reports both numbers and they have to be the same.`,
        layoutBlocked,
        warnings: [],
        months,
      };
    }

    /*
     * Not a refusal. A 24Q can be filed for a deductee whose PAN is
     * unavailable, and blocking would stop the company meeting a statutory
     * deadline over a data-quality problem — the exact harm this gate exists
     * to prevent.
     */
    const noPan = months.flatMap((month) => (deductees[month] ?? []).filter((d) => !d.pan));
    const names = [...new Set(noPan.map((d) => `${d.employeeName} (${d.employeeCode})`))];
    const warnings: string[] = [];
    /*
     * Recorded here, not only on screen. `apps/web/.../24q/page.tsx` shows
     * this as a static banner for Q4, but that reminder lives in the browser
     * only — it is invisible a week later when somebody returns to the
     * "Generated" list and downloads the frozen file. Pushing it into
     * `warnings` means it flows into `detail.warnings` on the stored
     * `TdsReturn` row in `generate()`, next to the file, for as long as the
     * file exists.
     */
    if (quarter === 'Q4') {
      warnings.push(
        'Q4 additionally requires Annexure II, the annual salary annexure, which this return does not produce. This file covers Annexure I only.',
      );
    }
    if (names.length) {
      warnings.push(
        `${names.length} ${names.length === 1 ? 'person has' : 'people have'} no PAN on record and will be filed as PAN-not-available, which attracts deduction at 20%: ${names.join(', ')}.`,
      );
    }
    return {
      blocked: null,
      layoutBlocked,
      warnings,
      months,
    };
  }

  /**
   * Takes the gathered snapshot as an argument rather than fetching its own,
   * so a caller that already gathered once (`generate()`) builds from
   * exactly what it evaluated, instead of re-querying and risking a file
   * that disagrees with the readiness that approved it.
   */
  private async built(
    claims: AccessTokenClaims,
    financialYear: string,
    quarter: TdsQuarterCode,
    statutory: OrgSettings['statutory'],
    gathered: Awaited<ReturnType<TdsReturnsService['gather']>>,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: claims.orgId },
      select: { name: true },
    });
    const { entries, deductees } = gathered;

    return build24Q({
      tan: statutory.tan,
      deductorName: org?.name ?? '',
      deductorPan: statutory.pan,
      responsiblePerson: statutory.signatoryName,
      financialYear,
      quarter,
      challans: entries,
      deductees,
    });
  }

  async preview(claims: AccessTokenClaims, financialYear: string, quarter: TdsQuarterCode) {
    const readiness = await this.readiness(claims, financialYear, quarter);
    if (readiness.blocked || readiness.layoutBlocked) {
      return { ...readiness, rowCount: 0, noPan: [], totals: {}, preview: [] };
    }
    const statutory = (await this.settings.get(claims.orgId)).statutory;
    const gathered = await this.gather(claims.orgId, financialYear, quarter);
    const result = await this.built(claims, financialYear, quarter, statutory, gathered);
    return {
      ...readiness,
      rowCount: result.rowCount,
      noPan: result.noPan,
      totals: result.totals,
      preview: result.content.split('\n').slice(0, 50),
    };
  }

  async generate(claims: AccessTokenClaims, financialYear: string, quarter: TdsQuarterCode) {
    const existing = await this.prisma.tdsReturn.findFirst({
      where: { organizationId: claims.orgId, financialYear, quarter },
    });
    if (existing) {
      throw new BadRequestException(
        `A 24Q for ${financialYear} ${quarter} was already generated on ${toDateKey(existing.generatedAt) ?? 'an earlier date'}. Download that one, or delete it first if the payroll has genuinely changed.`,
      );
    }

    /*
     * Settings and the payroll/challan snapshot are fetched exactly once,
     * here, and reused for both the readiness decision below and the file
     * `built()` produces afterwards. Calling the public `readiness()` and
     * then `built()` — as this used to — each does its own fetch, and a
     * payroll run can be unpublished, a payslip corrected, or a challan
     * edited between the two reads. The written file could then disagree
     * with the readiness that approved it, including silently omitting a
     * month whose run stopped being PUBLISHED between the two queries —
     * exactly the short-return harm the `missingRun` check exists to
     * prevent. Do not reintroduce a second gather here.
     */
    const statutory = (await this.settings.get(claims.orgId)).statutory;
    const gathered = await this.gather(claims.orgId, financialYear, quarter);
    const readiness = this.evaluate(statutory, gathered, quarter);
    // Either refusal stops a file being written: bad data, or a layout nobody
    // has transcribed. The screen shows them separately; generation does not
    // care which one it is.
    if (readiness.blocked) throw new BadRequestException(readiness.blocked);
    if (readiness.layoutBlocked) throw new BadRequestException(readiness.layoutBlocked);

    const result = await this.built(claims, financialYear, quarter, statutory, gathered);

    const row = await this.prisma.tdsReturn.create({
      data: {
        organizationId: claims.orgId,
        financialYear,
        quarter,
        content: result.content,
        rowCount: result.rowCount,
        excludedCount: result.noPan.length,
        detail: {
          noPan: result.noPan,
          totals: result.totals,
          warnings: readiness.warnings,
        } as object,
        generatedById: claims.sub,
      },
    });

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'payroll.tds.generate',
      'TdsReturn',
      row.id,
      { after: { financialYear, quarter, rowCount: result.rowCount } },
    );

    return {
      id: row.id,
      ...readiness,
      rowCount: result.rowCount,
      noPan: result.noPan,
      totals: result.totals,
    };
  }

  async list(claims: AccessTokenClaims, financialYear?: string) {
    return this.prisma.tdsReturn.findMany({
      where: { organizationId: claims.orgId, ...(financialYear ? { financialYear } : {}) },
      select: {
        id: true,
        financialYear: true,
        quarter: true,
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
    const row = await this.prisma.tdsReturn.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!row) throw new NotFoundException('Return not found');
    return {
      content: row.content,
      filename: `form24q-${row.financialYear}-${row.quarter}.txt`,
      contentType: 'text/plain; charset=utf-8',
    };
  }

  async remove(claims: AccessTokenClaims, id: string) {
    const row = await this.prisma.tdsReturn.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!row) throw new NotFoundException('Return not found');
    await this.prisma.tdsReturn.delete({ where: { id } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'payroll.tds.delete',
      'TdsReturn',
      id,
      { before: { financialYear: row.financialYear, quarter: row.quarter } },
    );
    return { id };
  }
}
