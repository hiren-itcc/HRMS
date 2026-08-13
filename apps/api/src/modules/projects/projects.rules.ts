import {
  OPEN_PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectStatusCode,
  type TimesheetStatusCode,
} from '@hrms/shared';
import { addDays, weekdayOf } from '../../common/utils/calendar';

/**
 * What may happen to a week, what it adds up to, and whether an hour was
 * allowed to be logged where it was.
 *
 * Pure, like `expense.rules.ts`, `asset.status.ts` and `settlement.calc.ts` —
 * no Prisma and no clock. `calendar.ts` is date arithmetic on YYYY-MM-DD keys
 * and reads no clock either, which is why it may be imported here.
 *
 * Hours arrive as `number`, not Decimal. Everything reaching these functions
 * has been through `projects.mapper.ts`, which is where Prisma's Decimal — a
 * string on the wire — becomes a number exactly once.
 */

/** Two decimal places, the same rounding the payroll and expense mappers use. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Nobody logs more than a day inside a day, across every project at once. */
export const MAX_DAILY_HOURS = 24;

/** What one full-time week is taken to be, for the utilisation denominator. */
export const STANDARD_WEEK_HOURS = 40;

export interface RuleEntry {
  projectId: string;
  workedOn: string;
  hours: number;
}

export interface RuleProject {
  id: string;
  code: string;
  status: ProjectStatusCode;
  startsOn: string;
  endsOn: string | null;
}

export interface RuleMembership {
  projectId: string;
  joinedOn: string;
  leftOn: string | null;
}

// ── The week ──────────────────────────────────────────────────────────

/**
 * The Monday of the week `dateKey` falls in.
 *
 * Monday rather than Sunday because the working week here is Monday-to-Friday
 * — a Sunday-start grid puts the weekend at both ends and splits nothing
 * useful. `weekdayOf` is UTC-based, so this does not drift with the server's
 * timezone.
 */
export function weekStartOf(dateKey: string): string {
  const day = weekdayOf(dateKey);
  // Sunday is 0, and belongs to the week that started six days earlier.
  return addDays(dateKey, -(day === 0 ? 6 : day - 1));
}

export function isWeekStart(dateKey: string): boolean {
  return weekdayOf(dateKey) === 1;
}

/** Monday through Sunday, in order. The columns of the grid. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

// ── What may happen to it ─────────────────────────────────────────────

/**
 * A draft is editable, and so is a week that was sent back — that is the whole
 * point of sending it back. Approved and submitted weeks are not.
 */
export function canEdit(status: TimesheetStatusCode): boolean {
  return status === 'DRAFT' || status === 'REJECTED';
}

/** The same set: if you may edit it, you may send it. */
export function canSubmit(status: TimesheetStatusCode): boolean {
  return canEdit(status);
}

/**
 * Pulling a week back before anybody has decided it.
 *
 * Withdrawal returns it to DRAFT rather than deleting it, because the week
 * still happened. A claim can simply not exist; a week somebody worked cannot.
 */
export function canWithdraw(status: TimesheetStatusCode): boolean {
  return status === 'SUBMITTED';
}

export function canDecide(status: TimesheetStatusCode): boolean {
  return status === 'SUBMITTED';
}

export function editError(status: TimesheetStatusCode): string {
  switch (status) {
    case 'SUBMITTED':
      return 'This week is with your manager — withdraw it first';
    case 'APPROVED':
      return 'This week was approved. Ask your manager to send it back if it needs changing';
    default:
      return 'This week cannot be edited';
  }
}

export function decisionError(status: TimesheetStatusCode): string {
  switch (status) {
    case 'DRAFT':
      return 'This week has not been submitted yet';
    case 'APPROVED':
      return 'This week was already approved';
    case 'REJECTED':
      return 'This week was already sent back';
    default:
      return 'This week cannot be decided';
  }
}

// ── What it adds up to ────────────────────────────────────────────────

export function weekTotal(entries: RuleEntry[]): number {
  return round2(entries.reduce((sum, entry) => sum + entry.hours, 0));
}

/** Keyed by YYYY-MM-DD. The row a per-day ceiling is checked against. */
export function dailyTotals(entries: RuleEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.workedOn, round2((totals.get(entry.workedOn) ?? 0) + entry.hours));
  }
  return totals;
}

export function totalsByProject(entries: RuleEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.projectId, round2((totals.get(entry.projectId) ?? 0) + entry.hours));
  }
  return totals;
}

// ── Whether an hour was allowed to be logged where it was ─────────────

/**
 * Why this hour cannot sit on this project on this day, or null if it can.
 *
 * Membership and the project's own window are checked separately because they
 * fail for different reasons and the person filling the form needs to know
 * which: "you are not on this project" and "this project had not started" lead
 * to different next actions.
 */
export function loggableProblem(
  project: RuleProject | undefined,
  membership: RuleMembership | undefined,
  dateKey: string,
): string | null {
  if (!project) return 'One line points at a project that no longer exists';

  if (!OPEN_PROJECT_STATUSES.includes(project.status)) {
    const state = PROJECT_STATUS_LABELS[project.status].toLowerCase();
    return `${project.code} is ${state} and takes no more hours`;
  }
  if (dateKey < project.startsOn) return `${project.code} had not started on ${dateKey}`;
  if (project.endsOn && dateKey > project.endsOn) {
    return `${project.code} had ended by ${dateKey}`;
  }

  if (!membership) return `You are not a member of ${project.code}`;
  if (dateKey < membership.joinedOn) return `You joined ${project.code} after ${dateKey}`;
  if (membership.leftOn && dateKey > membership.leftOn) {
    return `You left ${project.code} before ${dateKey}`;
  }
  return null;
}

/**
 * Everything stopping a week from being submitted, in one pass.
 *
 * One call rather than five, for the reason `submissionProblems` gives in the
 * expenses module: being told about one problem, fixing it, and only then
 * being told about the next is how people give up on a form.
 *
 * Deduplicated, because a project that closed last month produces the same
 * sentence once per day it was logged against, and five copies of it are not
 * five pieces of information.
 */
export function submissionProblems(
  entries: RuleEntry[],
  projects: RuleProject[],
  memberships: RuleMembership[],
  weekStart: string,
): { problems: string[]; total: number } {
  const problems: string[] = [];

  if (!isWeekStart(weekStart)) {
    problems.push('A timesheet week runs Monday to Sunday');
  }
  if (entries.length === 0) {
    problems.push('Log some hours before submitting');
  }

  const days = new Set(weekDays(weekStart));
  const byProject = new Map(projects.map((project) => [project.id, project]));
  const byMembership = new Map(memberships.map((member) => [member.projectId, member]));

  for (const entry of entries) {
    if (!days.has(entry.workedOn)) {
      problems.push(`${entry.workedOn} is not in the week beginning ${weekStart}`);
      continue;
    }
    if (entry.hours <= 0) {
      problems.push(`${entry.workedOn} has a line with no hours on it`);
    }
    // Defence in depth: zod already refuses this on the wire, but the seed and
    // any future importer reach the rules without passing through it.
    if (round2(entry.hours * 4) % 1 !== 0) {
      problems.push(`${entry.workedOn} has hours that are not a quarter-hour step`);
    }
    const problem = loggableProblem(
      byProject.get(entry.projectId),
      byMembership.get(entry.projectId),
      entry.workedOn,
    );
    if (problem) problems.push(problem);
  }

  for (const [dateKey, total] of dailyTotals(entries)) {
    if (total > MAX_DAILY_HOURS) {
      problems.push(`${dateKey} adds up to ${total} hours, and a day has ${MAX_DAILY_HOURS}`);
    }
  }

  return { problems: [...new Set(problems)], total: weekTotal(entries) };
}

// ── Guardrails on the register ────────────────────────────────────────

/**
 * Why this project cannot be deleted, or null if it can.
 *
 * The database would refuse anyway — `TimesheetEntry.projectId` is RESTRICT —
 * but it would refuse as a raw Prisma error and a 500. This is the same
 * `_count` pre-flight `expense-categories.service.ts` runs, so the answer
 * arrives as a sentence naming the count and the way out.
 */
export function deleteBlockedReason(entries: number): string | null {
  if (entries > 0) {
    const noun = entries === 1 ? 'entry has' : 'entries have';
    return `${entries} timesheet ${noun} been logged against this project — mark it Completed or Cancelled instead of deleting it`;
  }
  return null;
}

/**
 * Why this person cannot be taken off the project, or null if they can.
 *
 * Same shape, different remedy: somebody who has logged hours here rolled off,
 * they were never not on it, and `leftOn` is how that is recorded.
 */
export function memberRemovalBlockedReason(entries: number): string | null {
  if (entries > 0) {
    const noun = entries === 1 ? 'entry' : 'entries';
    return `This person has ${entries} timesheet ${noun} on this project — set a leaving date instead of removing them`;
  }
  return null;
}

// ── Utilisation ───────────────────────────────────────────────────────

/** A full-time person's hours over `weeks` weeks. The denominator, and nothing more. */
export function capacityHours(weeks: number): number {
  return round2(Math.max(weeks, 0) * STANDARD_WEEK_HOURS);
}

export function utilisationPercent(logged: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return round2((logged / capacity) * 100);
}
