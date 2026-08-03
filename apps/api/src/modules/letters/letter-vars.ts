import { type LetterTemplateDefault, letterTemplateDefault, SALARY_VARIABLES } from '@hrms/shared';
import type { TemplateVars } from '../mail/template-renderer';
import { usedVariables } from '../mail/template-renderer';

/**
 * Builds the variable bag a letter renders from. Pure — no Prisma, no I/O —
 * so the rules that matter (never a visible placeholder, never a blank salary)
 * are unit-testable on their own.
 */

/** Everything the builder needs, already loaded by the service. */
export interface LetterSubject {
  employeeCode: string;
  firstName: string;
  lastName: string;
  joinDate: Date;
  exitDate: Date | null;
  department: { name: string } | null;
  designation: { title: string } | null;
  location: { name: string } | null;
  employmentType: { name: string } | null;
  manager: { firstName: string; lastName: string } | null;
}

export interface LetterContext {
  orgName: string;
  letterNumber: string;
  issuedByName: string;
  issueDate: Date;
  /** Null when no salary has been assigned — never silently zero. */
  monthlyCtc: number | null;
}

/** Matches the web's formatMoney exactly, or a certificate and a payslip disagree. */
export function formatMoney(amount: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** "2 August 2026" — the long form, because this is going on paper. */
export function formatLetterDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** "2 years 4 months", or "less than a month" — never "0 years 0 months". */
export function formatTenure(from: Date, to: Date): string {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  if (months < 1) return 'less than a month';

  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rest > 0) parts.push(`${rest} month${rest === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/**
 * A letter quotes salary if its template says so OR if the effective body
 * actually interpolates a salary variable. The second half is what stops a
 * customised appointment letter from smuggling a CTC past the access gate.
 */
export function bodyContainsSalary(template: LetterTemplateDefault, bodyHtml: string): boolean {
  if (template.containsSalary) return true;
  const used = new Set(usedVariables(bodyHtml));
  return SALARY_VARIABLES.some((name) => used.has(name));
}

/**
 * Every declared variable resolves to a non-empty string.
 *
 * `render()` deliberately leaves an unresolved `{{exitDate}}` visible — right
 * for a test email, unacceptable on a letter that is then frozen forever. So
 * absent facts become words ("present", "—"), never null and never blank.
 */
export function buildLetterVars(subject: LetterSubject, context: LetterContext): TemplateVars {
  const employeeName = `${subject.firstName} ${subject.lastName}`.trim();
  const endOfTenure = subject.exitDate ?? context.issueDate;

  const vars: TemplateVars = {
    orgName: context.orgName,
    letterNumber: context.letterNumber,
    issueDate: formatLetterDate(context.issueDate),
    issuedByName: context.issuedByName,
    employeeName,
    employeeCode: subject.employeeCode,
    designation: subject.designation?.title ?? '—',
    department: subject.department?.name ?? '—',
    location: subject.location?.name ?? '—',
    employmentType: subject.employmentType?.name ?? 'full-time',
    managerName: subject.manager
      ? `${subject.manager.firstName} ${subject.manager.lastName}`.trim()
      : 'the management',
    joinDate: formatLetterDate(subject.joinDate),
    // A serving employee's experience letter reads "to present" rather than
    // showing a gap where a date should be.
    exitDate: subject.exitDate ? formatLetterDate(subject.exitDate) : 'present',
    tenure: formatTenure(subject.joinDate, endOfTenure),
  };

  if (context.monthlyCtc !== null) {
    vars.monthlyCtc = formatMoney(context.monthlyCtc);
    vars.annualCtc = formatMoney(context.monthlyCtc * 12);
  }

  return vars;
}

/**
 * Declared variables with no value — the check that must run *before* a letter
 * is frozen. Returns [] when the letter is safe to issue.
 */
export function missingVariables(templateKey: string, bodyHtml: string, vars: TemplateVars) {
  const declared = letterTemplateDefault(templateKey)?.variables ?? [];
  const used = usedVariables(bodyHtml);
  const names = new Set([...declared, ...used]);
  return [...names].filter((name) => {
    const value = vars[name];
    return value === undefined || value === null || String(value).trim() === '';
  });
}
