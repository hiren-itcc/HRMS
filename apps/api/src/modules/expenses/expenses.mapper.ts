/**
 * Decimal → number, at the boundary and nowhere else.
 *
 * Prisma's `Decimal` serializes to JSON as a **string**, while the web side
 * declares these fields `number`. Nothing fails: the screen formats a string as
 * `NaN` and there is no stack trace to find. Recruitment shipped exactly that
 * bug and `recruitment.mapper.ts` is the fix; payroll's `toMoney` is the older
 * one. "Every module converts its own Decimals" is a convention nothing
 * enforces, which is why each module writes this down.
 *
 * `capPerClaim` keeps `null` rather than becoming 0, the same distinction
 * recruitment's salary band makes: a category with no ceiling is not a category
 * that allows nothing.
 */

export function money(value: unknown): number {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

export function optionalMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return money(value);
}

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  capPerClaim: unknown;
  requiresReceipt: boolean;
  componentId: string;
  active: boolean;
  order: number;
  component?: { id: string; code: string; name: string; kind: string } | null;
}

export function mapCategory(row: CategoryRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    capPerClaim: optionalMoney(row.capPerClaim),
    requiresReceipt: row.requiresReceipt,
    componentId: row.componentId,
    component: row.component ?? undefined,
    active: row.active,
    order: row.order,
  };
}

interface ItemRow {
  id: string;
  categoryId: string;
  spentOn: Date;
  amount: unknown;
  description: string;
  receiptId: string | null;
  category?: { id: string; name: string; code: string } | null;
}

interface ClaimRow {
  id: string;
  employeeId: string;
  title: string;
  status: string;
  payrollMonth: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  items?: ItemRow[];
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
  } | null;
}

/** `YYYY-MM-DD`, in UTC — the same key every other date on the wire uses. */
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function mapItem(row: ItemRow) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    category: row.category ?? undefined,
    spentOn: dateKey(row.spentOn),
    amount: money(row.amount),
    description: row.description,
    receiptId: row.receiptId,
  };
}

/**
 * `paid` is derived, never stored.
 *
 * Whether the money arrived is whether the payroll run for `payrollMonth` was
 * published, and payroll already knows that. A stored copy is the one that goes
 * stale — the same reasoning behind attendance's derive-on-read day close and
 * announcement expiry in the query `where`.
 */
export function mapClaim(row: ClaimRow, publishedMonths: ReadonlySet<string>) {
  const items = (row.items ?? []).map(mapItem);
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: row.employee ?? undefined,
    title: row.title,
    status: row.status,
    payrollMonth: row.payrollMonth,
    paid: row.status === 'APPROVED' && !!row.payrollMonth && publishedMonths.has(row.payrollMonth),
    total: money(items.reduce((sum, item) => sum + item.amount, 0)),
    itemCount: items.length,
    items,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}
