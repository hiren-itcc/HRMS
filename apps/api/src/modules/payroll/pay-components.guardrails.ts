import { COMPONENT_CODES } from '@hrms/shared';

/**
 * Pure guardrails for the pay component editor — no Prisma, no I/O.
 *
 * Component codes are looked up by name across the calculation engine, and
 * every lookup falls back to `0` or `undefined` rather than throwing.
 * Renaming `BASIC`'s code silently zeroes PF, every `PERCENT_OF_BASIC`
 * structure line, the payroll register's Basic column, PF/ESI ECR wages and
 * the gratuity basis — nothing errors, anywhere. `code` is therefore
 * immutable after creation for every component (enforced by the update
 * schema simply having no `code` field, not by anything here), and this
 * module locks the fields the engine also hardcodes.
 *
 * `isStatutory` looks like the right flag to guard on and is not: `TDS` is
 * `isStatutory: false` (deliberately — entered per employee rather than
 * projected) yet `payroll.calc.ts` hardcodes it by code regardless. `COMPONENT_CODES` is the set the engine actually looks
 * up, so it is the only authority this module trusts.
 */

/** The codes the calculation engine hardcodes — see `COMPONENT_CODES`. */
export const PROTECTED_CODES: ReadonlySet<string> = new Set(Object.values(COMPONENT_CODES));

export type GuardrailReason = string | null;

export type LockedField = 'kind' | 'taxable' | 'isStatutory';

const LOCKED_FIELDS: readonly LockedField[] = ['kind', 'taxable', 'isStatutory'];

export interface PayComponentLike {
  code: string;
}

export interface PayComponentFields {
  code: string;
  kind: string;
  taxable: boolean;
  isStatutory: boolean;
}

export interface ReferenceCounts {
  structureLines: number;
  adjustments: number;
  expenseCategories: number;
}

/** Is this code one the calculation engine hardcodes? */
export function isProtected(code: string): boolean {
  return PROTECTED_CODES.has(code);
}

/** Which fields a protected component may not change. Empty for everything else. */
export function lockedFields(component: PayComponentLike): readonly LockedField[] {
  return isProtected(component.code) ? LOCKED_FIELDS : [];
}

/**
 * Would this patch change a locked field on a protected component?
 *
 * Compared against the current value, not mere presence in the patch, so a
 * client that round-trips a field's unchanged value is never blocked —
 * only an actual change to `kind`, `taxable` or `isStatutory` is.
 */
export function editBlockedReason(
  existing: PayComponentFields,
  patch: Partial<Pick<PayComponentFields, 'kind' | 'taxable' | 'isStatutory'>>,
): GuardrailReason {
  if (!isProtected(existing.code)) return null;

  const changed = LOCKED_FIELDS.filter(
    (field) => patch[field] !== undefined && patch[field] !== existing[field],
  );
  if (changed.length === 0) return null;

  return `${existing.code} is a core payroll component the calculation engine depends on — ${changed.join(', ')} cannot be changed`;
}

/**
 * Would deleting this component break something?
 *
 * Protected components are never deletable, full stop — `active: false` is
 * the safe delete every consumer already filters on. Everything else
 * (user-created, or seeded but not in `COMPONENT_CODES`) is deletable only
 * when nothing references it: `StructureLine`, `PayrollAdjustment` and
 * `ExpenseCategory` all FK to `PayComponent` with Prisma's default
 * `Restrict`, and nothing catches P2003 for this model — without this
 * pre-flight a delete would return a raw 500 instead of a readable sentence.
 */
export function deleteBlockedReason(
  component: PayComponentLike,
  counts: ReferenceCounts,
): GuardrailReason {
  if (isProtected(component.code)) {
    return `${component.code} is a core payroll component the calculation engine depends on and cannot be deleted — deactivate it instead`;
  }

  const parts: string[] = [];
  if (counts.structureLines > 0) {
    parts.push(
      `${counts.structureLines} salary structure${counts.structureLines === 1 ? '' : 's'}`,
    );
  }
  if (counts.adjustments > 0) {
    parts.push(`${counts.adjustments} payroll adjustment${counts.adjustments === 1 ? '' : 's'}`);
  }
  if (counts.expenseCategories > 0) {
    parts.push(
      `${counts.expenseCategories} expense categor${counts.expenseCategories === 1 ? 'y' : 'ies'}`,
    );
  }
  if (parts.length === 0) return null;

  return `${component.code} is used by ${joinWithAnd(parts)} — deactivate it instead of deleting`;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
