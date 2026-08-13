import { round2 } from './projects.rules';

/**
 * Decimal → number, at the boundary and nowhere else.
 *
 * Prisma's `Decimal` serializes to JSON as a **string**, while the web side
 * declares `hours` a `number`. Nothing throws: the grid renders `NaN` and there
 * is no stack trace to find. `expenses.mapper.ts` and `recruitment.mapper.ts`
 * exist for the same reason — "every module converts its own Decimals" is a
 * convention nothing enforces, which is why each module writes it down.
 *
 * `hours` is the only Decimal in this module. There is no money here at all.
 */

export function hoursOf(value: unknown): number {
  return round2(Number(value ?? 0));
}

/** `YYYY-MM-DD`, in UTC — the same key every other date on the wire uses. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function optionalDateKey(date: Date | null): string | null {
  return date ? dateKey(date) : null;
}

/** Exported because it surfaces in every mapped row's inferred return type. */
export interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

interface MemberRow {
  id: string;
  projectId: string;
  employeeId: string;
  role: string | null;
  allocation: number;
  joinedOn: Date;
  leftOn: Date | null;
  employee?: PersonRow | null;
}

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  startsOn: Date;
  endsOn: Date | null;
  managerId: string;
  createdAt: Date;
  updatedAt: Date;
  manager?: PersonRow | null;
  members?: MemberRow[];
  _count?: { members?: number; entries?: number };
}

interface EntryRow {
  id: string;
  projectId: string;
  workedOn: Date;
  hours: unknown;
  note: string | null;
  project?: { id: string; code: string; name: string; status: string } | null;
}

interface TimesheetRow {
  id: string;
  employeeId: string;
  weekStart: Date;
  status: string;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  entries?: EntryRow[];
  employee?: PersonRow | null;
}

export function mapMember(row: MemberRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    employeeId: row.employeeId,
    employee: row.employee ?? undefined,
    role: row.role,
    allocation: row.allocation,
    joinedOn: dateKey(row.joinedOn),
    leftOn: optionalDateKey(row.leftOn),
  };
}

export function mapProject(row: ProjectRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    startsOn: dateKey(row.startsOn),
    endsOn: optionalDateKey(row.endsOn),
    managerId: row.managerId,
    manager: row.manager ?? undefined,
    members: row.members?.map(mapMember),
    memberCount: row._count?.members,
    entryCount: row._count?.entries,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapEntry(row: EntryRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    project: row.project ?? undefined,
    workedOn: dateKey(row.workedOn),
    hours: hoursOf(row.hours),
    note: row.note,
  };
}

/**
 * `total` is derived on every read rather than stored.
 *
 * A stored total is the one that goes stale the moment an entry is edited, and
 * a week whose header disagrees with its own grid is worse than no header. The
 * same call attendance makes for its day close and expenses makes for `paid`.
 */
export function mapTimesheet(row: TimesheetRow) {
  const entries = (row.entries ?? []).map(mapEntry);
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: row.employee ?? undefined,
    weekStart: dateKey(row.weekStart),
    status: row.status,
    total: round2(entries.reduce((sum, entry) => sum + entry.hours, 0)),
    entryCount: entries.length,
    entries,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}
