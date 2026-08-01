import { dateKeyOf } from '../../common/utils/calendar';
import { availableDays, round1 } from './leave.util';

/** Prisma Decimal → number (it serializes as a string otherwise). */
export function toNumber(value: unknown): number {
  return round1(Number(value ?? 0));
}

/*
 * These describe what the mapper reads, not one specific Prisma include —
 * callers pass rows with `leaveType` and `employee` present or absent, which
 * is what `any` was papering over. Structural types keep that flexibility
 * while still failing the build if a column is renamed out from under them.
 *
 * `employee` is forwarded verbatim, so `unknown` is the honest type: this
 * mapper reads nothing inside it.
 */
interface BalanceRow {
  id: string;
  year: number;
  leaveTypeId: string;
  allocated: unknown;
  carriedOver: unknown;
  used: unknown;
  leaveType?: { id: string; name: string; code: string; isPaid: boolean } | null;
  employee?: unknown;
}

interface RequestRow {
  id: string;
  startDate: Date;
  endDate: Date;
  halfDaySide: string | null;
  days: unknown;
  reason: string;
  status: string;
  approverNote: string | null;
  actedAt: Date | null;
  createdAt: Date;
  leaveType?: { id: string; name: string; code: string } | null;
  employee?: unknown;
}

/** Balance row → API shape with the derived `available` figure. */
export function mapBalance(row: BalanceRow) {
  const allocated = toNumber(row.allocated);
  const carriedOver = toNumber(row.carriedOver);
  const used = toNumber(row.used);
  return {
    id: row.id,
    year: row.year,
    leaveTypeId: row.leaveTypeId,
    leaveType: row.leaveType
      ? {
          id: row.leaveType.id,
          name: row.leaveType.name,
          code: row.leaveType.code,
          isPaid: row.leaveType.isPaid,
        }
      : undefined,
    employee: row.employee,
    allocated,
    carriedOver,
    used,
    available: availableDays({ allocated, carriedOver, used }),
  };
}

/** Leave request row → API shape (dates as YYYY-MM-DD, days as number). */
export function mapRequest(row: RequestRow) {
  return {
    id: row.id,
    startDate: dateKeyOf(row.startDate),
    endDate: dateKeyOf(row.endDate),
    halfDaySide: row.halfDaySide,
    days: toNumber(row.days),
    reason: row.reason,
    status: row.status,
    approverNote: row.approverNote,
    actedAt: row.actedAt,
    createdAt: row.createdAt,
    leaveType: row.leaveType
      ? { id: row.leaveType.id, name: row.leaveType.name, code: row.leaveType.code }
      : undefined,
    employee: row.employee,
  };
}
