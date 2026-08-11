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
  /**
   * The same key → the name as it is actually spelled.
   *
   * Matching is normalised, but a suggestion has to be *copyable*: a person
   * reading `Did you mean "bengaluru studio"?` and pasting that back has typed
   * something that is not the location's name. Against the seeded org the
   * messages read "engineering", "general" and "senior software engineer" —
   * none of which is what those records are called.
   */
  display: Map<string, string>;
  /** What to call it when it is missing: "Department", "Shift". */
  label: string;
}

/** Case- and whitespace-insensitive, because a spreadsheet pads and shouts. */
export function makeLookup(rows: { id: string; name: string }[], label: string): Lookup {
  const byName = new Map<string, string>();
  const display = new Map<string, string>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    byName.set(key, row.id);
    display.set(key, row.name.trim());
  }
  return { byName, display, label };
}

/**
 * The nearest thing to what they typed, so a typo can be corrected rather than
 * hunted for. Cheap edit-distance — the lists here are tens of items, not
 * thousands, and being clever would be the wrong trade.
 */
function editDistance(a: string, b: string): number {
  // One row at a time — these strings are department names, not documents.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}

export function nearestName(value: string, lookup: Lookup): string | undefined {
  const needle = value.trim().toLowerCase();
  if (!needle) return undefined;

  /*
   * Two passes, because the two kinds of near miss deserve different bars.
   *
   * Containment — "Eng" or "Engineering Team" against "Engineering" — is
   * already strong evidence on its own, so it is accepted whatever the length
   * difference and merely *ranked* by it. Applying an edit-distance tolerance
   * to it would reject "People" against "People Operations", which is the most
   * obvious suggestion there is.
   */
  let contained: { name: string; score: number } | undefined;
  for (const name of lookup.byName.keys()) {
    if (!name.includes(needle) && !needle.includes(name)) continue;
    const score = Math.abs(name.length - needle.length);
    if (!contained || score < contained.score) contained = { name, score };
  }
  if (contained) return lookup.display.get(contained.name) ?? contained.name;

  /*
   * Otherwise a typo: a dropped or transposed letter, which no amount of
   * substring matching catches and which is exactly the case worth suggesting
   * for. A third of the word is the point past which "did you mean" is a guess
   * rather than a help, and a wrong suggestion is worse than none.
   */
  let nearest: { name: string; score: number } | undefined;
  for (const name of lookup.byName.keys()) {
    const score = editDistance(name, needle);
    const tolerance = Math.max(2, Math.floor(name.length / 3));
    if (score <= tolerance && (!nearest || score < nearest.score)) nearest = { name, score };
  }
  return nearest && (lookup.display.get(nearest.name) ?? nearest.name);
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
