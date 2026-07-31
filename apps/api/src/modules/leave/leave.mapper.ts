import { dateKeyOf } from '../../common/utils/calendar';
import { availableDays, round1 } from './leave.util';

/** Prisma Decimal → number (it serializes as a string otherwise). */
export function toNumber(value: unknown): number {
  return round1(Number(value ?? 0));
}

/** Balance row → API shape with the derived `available` figure. */
// biome-ignore lint/suspicious/noExplicitAny: Prisma row shapes vary by include
export function mapBalance(row: any) {
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
// biome-ignore lint/suspicious/noExplicitAny: Prisma row shapes vary by include
export function mapRequest(row: any) {
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
