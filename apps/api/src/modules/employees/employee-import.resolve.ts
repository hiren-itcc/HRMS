import type { ImportRowProblem } from '@hrms/shared';

/**
 * Turning what somebody typed into a spreadsheet into ids.
 *
 * Pure — no Prisma, no clock — like `expense.rules.ts` and its siblings. The
 * lookups arrive as maps that the service has already loaded once for the whole
 * file rather than once per row.
 */

export interface Lookup {
  /** Lower-cased, trimmed name → id. */
  byName: Map<string, string>;
  /** What to call it when it is missing: "Department", "Shift". */
  label: string;
}

/** Case- and whitespace-insensitive, because a spreadsheet pads and shouts. */
export function makeLookup(rows: { id: string; name: string }[], label: string): Lookup {
  const byName = new Map<string, string>();
  for (const row of rows) byName.set(row.name.trim().toLowerCase(), row.id);
  return { byName, label };
}

/**
 * The nearest thing to what they typed, so a typo can be corrected rather than
 * hunted for. Cheap edit-distance — the lists here are tens of items, not
 * thousands, and being clever would be the wrong trade.
 */
export function nearestName(value: string, lookup: Lookup): string | undefined {
  const needle = value.trim().toLowerCase();
  if (!needle) return undefined;
  let best: { name: string; score: number } | undefined;
  for (const name of lookup.byName.keys()) {
    // Substring either way catches "Enginering" against "Engineering" poorly,
    // but catches "Eng" and "Engineering Team" well, which is the common typo.
    const score =
      name.includes(needle) || needle.includes(name) ? Math.abs(name.length - needle.length) : -1;
    if (score >= 0 && (!best || score < best.score)) best = { name, score };
  }
  return best?.name;
}

export interface ResolveResult {
  id?: string;
  problem?: ImportRowProblem;
}

/**
 * Resolve one reference, or say precisely what is wrong with it.
 *
 * **Never auto-creates.** Inventing a department because somebody typed
 * "Enginering" is how an organization ends up with that spelling forever,
 * beside the correct one, in every report. The suggestion goes in the message
 * instead and a person decides.
 */
export function resolveRef(
  value: string,
  lookup: Lookup,
  column: string,
  required: boolean,
): ResolveResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? { problem: { column, message: `${lookup.label} is required`, value } } : {};
  }
  const id = lookup.byName.get(trimmed.toLowerCase());
  if (id) return { id };

  const suggestion = nearestName(trimmed, lookup);
  return {
    problem: {
      column,
      value: trimmed,
      message: suggestion
        ? `No ${lookup.label.toLowerCase()} called "${trimmed}". Did you mean "${suggestion}"?`
        : `No ${lookup.label.toLowerCase()} called "${trimmed}"`,
    },
  };
}

export interface ManagerCandidate {
  id: string;
  employeeCode: string;
  workEmail: string;
  firstName: string;
  lastName: string;
}

export interface ManagerResolution {
  id?: string;
  /** The manager is a later row in this same file. */
  deferred?: boolean;
  problem?: ImportRowProblem;
}

/**
 * A manager, by code, then by work email, then by full name.
 *
 * `Employee` has no unique constraint on a name, so an ambiguous full name is
 * an **error naming both matches** rather than a silent pick — getting somebody
 * else's reporting line wrong is exactly the failure that is never noticed.
 *
 * A manager who appears further down the same file is the *normal* case when
 * importing an organization top-down, so it is deferred to a second pass rather
 * than reported as missing. Without that, a sensible file fails on almost every
 * row.
 */
export function resolveManager(
  value: string,
  existing: ManagerCandidate[],
  emailsInFile: Set<string>,
): ManagerResolution {
  const trimmed = value.trim();
  if (!trimmed) return {};

  const needle = trimmed.toLowerCase();

  const byCode = existing.find((e) => e.employeeCode.toLowerCase() === needle);
  if (byCode) return { id: byCode.id };

  const byEmail = existing.find((e) => e.workEmail.toLowerCase() === needle);
  if (byEmail) return { id: byEmail.id };

  const byName = existing.filter(
    (e) => `${e.firstName} ${e.lastName}`.trim().toLowerCase() === needle,
  );
  if (byName.length === 1 && byName[0]) return { id: byName[0].id };
  if (byName.length > 1) {
    return {
      problem: {
        column: 'Manager',
        value: trimmed,
        message: `More than one person is called "${trimmed}" (${byName
          .map((e) => e.employeeCode)
          .join(', ')}). Use their employee code or work email instead.`,
      },
    };
  }

  // Somewhere later in this file. Linked on the second pass.
  if (emailsInFile.has(needle)) return { deferred: true };

  return {
    problem: {
      column: 'Manager',
      value: trimmed,
      message: `No employee matches "${trimmed}". Use an employee code, a work email, or an exact full name.`,
    },
  };
}
