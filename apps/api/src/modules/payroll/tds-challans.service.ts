import type { TdsChallanCreateInput } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { toDateKey, toMoney } from './payroll.mapper';
import { monthsIn } from './tds-period';

type ChallanRow = {
  id: string;
  period: string;
  bsrCode: string;
  challanSerial: string;
  depositDate: Date | string;
  sectionCode: string;
  minorHead: string;
  tds: unknown;
  surcharge: unknown;
  educationCess: unknown;
  interest: unknown;
  fee: unknown;
  penalty: unknown;
  others: unknown;
};

/**
 * The TDS challan register.
 *
 * One challan per month, enforced by the unique constraint rather than by a
 * check here: Form 24Q requires every deductee row to name its challan, and
 * with one per month that mapping is derivable instead of an allocation screen.
 */
@Injectable()
export class TdsChallansService {
  constructor(private readonly prisma: PrismaService) {}

  /** Decimal to number, at the boundary and nowhere else. */
  private map(row: ChallanRow) {
    return {
      id: row.id,
      period: row.period,
      bsrCode: row.bsrCode,
      challanSerial: row.challanSerial,
      depositDate: toDateKey(row.depositDate) as string,
      sectionCode: row.sectionCode,
      minorHead: row.minorHead,
      tds: toMoney(row.tds),
      surcharge: toMoney(row.surcharge),
      educationCess: toMoney(row.educationCess),
      interest: toMoney(row.interest),
      fee: toMoney(row.fee),
      penalty: toMoney(row.penalty),
      others: toMoney(row.others),
      total: toMoney(
        [row.tds, row.surcharge, row.educationCess, row.interest, row.fee, row.penalty, row.others]
          .map((value) => toMoney(value))
          .reduce((sum, value) => sum + value, 0),
      ),
    };
  }

  async list(claims: AccessTokenClaims, financialYear?: string) {
    const rows = await this.prisma.tdsChallan.findMany({
      where: {
        organizationId: claims.orgId,
        ...(financialYear
          ? {
              period: {
                in: (['Q1', 'Q2', 'Q3', 'Q4'] as const).flatMap((quarter) =>
                  monthsIn(financialYear, quarter),
                ),
              },
            }
          : {}),
      },
      orderBy: { period: 'desc' },
    });
    return rows.map((row) => this.map(row as ChallanRow));
  }

  async create(claims: AccessTokenClaims, input: TdsChallanCreateInput) {
    const row = await this.prisma.tdsChallan.create({
      data: {
        organizationId: claims.orgId,
        ...input,
        depositDate: new Date(input.depositDate),
        createdById: claims.sub,
      },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'payroll.challan.create',
      'TdsChallan',
      row.id,
      { after: { period: input.period, tds: input.tds } },
    );
    return this.map(row as ChallanRow);
  }

  async update(claims: AccessTokenClaims, id: string, input: TdsChallanCreateInput) {
    const existing = await this.prisma.tdsChallan.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!existing) throw new NotFoundException('Challan not found');

    const row = await this.prisma.tdsChallan.update({
      where: { id },
      data: { ...input, depositDate: new Date(input.depositDate) },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'payroll.challan.update',
      'TdsChallan',
      id,
      { before: { period: existing.period }, after: { period: input.period, tds: input.tds } },
    );
    return this.map(row as ChallanRow);
  }

  async remove(claims: AccessTokenClaims, id: string) {
    const existing = await this.prisma.tdsChallan.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!existing) throw new NotFoundException('Challan not found');

    await this.prisma.tdsChallan.delete({ where: { id } });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'payroll.challan.delete',
      'TdsChallan',
      id,
      { before: { period: existing.period } },
    );
    return { id };
  }
}
