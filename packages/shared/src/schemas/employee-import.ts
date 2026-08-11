import { z } from 'zod';

/**
 * Bulk employee import.
 *
 * The spreadsheet carries **names**, not ids — nobody types a cuid into Excel —
 * so a row is parsed here, resolved against the organization's own departments
 * and designations, and only then handed to `employeeCreateSchema`. That second
 * pass is the point: the importer cannot accept a record that
 * `POST /employees` would reject, because it is checked by the same schema.
 *
 * Bank details are deliberately absent in both directions. An account number in
 * a spreadsheet that gets emailed around is an incident, and `EmployeesService`
 * already treats bank details as the most restricted field in the product.
 */

/**
 * One canonical column list, shared by the downloadable template, the parser
 * and the export. That is what makes "export, edit two cells, re-import" work
 * without anybody maintaining two lists that drift.
 */
export const EMPLOYEE_IMPORT_COLUMNS = [
  { key: 'employeeCode', header: 'Employee code', required: false },
  { key: 'firstName', header: 'First name', required: true },
  { key: 'lastName', header: 'Last name', required: true },
  { key: 'workEmail', header: 'Work email', required: true },
  { key: 'personalEmail', header: 'Personal email', required: false },
  { key: 'phone', header: 'Phone', required: false },
  { key: 'dateOfBirth', header: 'Date of birth', required: false },
  { key: 'gender', header: 'Gender', required: false },
  { key: 'joinDate', header: 'Join date', required: true },
  { key: 'department', header: 'Department', required: true },
  { key: 'designation', header: 'Designation', required: true },
  { key: 'location', header: 'Location', required: true },
  { key: 'shift', header: 'Shift', required: true },
  { key: 'employmentType', header: 'Employment type', required: true },
  { key: 'manager', header: 'Manager', required: false },
] as const;

export type EmployeeImportColumn = (typeof EMPLOYEE_IMPORT_COLUMNS)[number]['key'];

/** Header → key, matched lower-case, so column order never matters. */
export const IMPORT_HEADER_TO_KEY: Record<string, EmployeeImportColumn> = Object.fromEntries(
  EMPLOYEE_IMPORT_COLUMNS.map((c) => [c.header.toLowerCase(), c.key]),
);

export const REQUIRED_IMPORT_HEADERS = EMPLOYEE_IMPORT_COLUMNS.filter((c) => c.required).map(
  (c) => c.header,
);

/**
 * Two modes, and the default is the safe one.
 *
 * `RECORDS` backfills people who already work here: no login, no email. It goes
 * through `EmployeesService.create`, which supports exactly that and carries an
 * employee-code collision retry.
 *
 * `INVITE` is for actual new starters and goes through
 * `OnboardingService.onboard` — the same path recruitment's hire uses — so the
 * invite, the INVITED user and the code generation stay in one place. It
 * requires a personal email per row, because that is where the invite goes.
 */
export const IMPORT_MODES = ['RECORDS', 'INVITE'] as const;
export const importModeSchema = z.enum(IMPORT_MODES);
export type ImportMode = (typeof IMPORT_MODES)[number];

export const IMPORT_MODE_LABELS: Record<ImportMode, string> = {
  RECORDS: 'Add records only — no logins, no email',
  INVITE: 'Add and invite — each person gets an email',
};

export const IMPORT_STATUSES = ['PREVIEW', 'COMMITTED', 'PARTIAL', 'FAILED'] as const;
export const importStatusSchema = z.enum(IMPORT_STATUSES);
export type ImportStatusCode = (typeof IMPORT_STATUSES)[number];

/**
 * A file bigger than this is a mistake, not an import.
 *
 * Creation runs sequentially through the existing services — never
 * `Promise.all`, because `nextCode()` inside `onboard` has no collision retry —
 * so a very large file would hold a request open for minutes. The repo
 * deliberately has no queue, so the answer is a cap and "split the file"
 * rather than BullMQ.
 */
export const MAX_IMPORT_ROWS = 500;

/**
 * And a much lower cap on invites, because there is no undo for a sent email.
 * The screen states the count before it will let the box be ticked.
 */
export const MAX_INVITES_PER_IMPORT = 50;

export const importPreviewQuerySchema = z.object({
  mode: importModeSchema.default('RECORDS'),
});
export type ImportPreviewQuery = z.infer<typeof importPreviewQuerySchema>;

export const importCommitSchema = z.object({
  /**
   * Opt-in, never inferred from the mode alone. An import that emails two
   * hundred people by accident cannot be taken back, so the mode says what
   * *kind* of import this is and this says the operator looked at the count.
   */
  sendInvites: z.boolean().default(false),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;

export interface ImportRowProblem {
  column: string;
  message: string;
  /** What was in the cell, so the message can be acted on without the file. */
  value?: string;
}

export interface ImportRowPreview {
  row: number;
  workEmail: string;
  name: string;
  problems: ImportRowProblem[];
  /**
   * A manager who appears further down the same file. Normal when importing an
   * organization top-down, so it is reported as "linked afterwards" rather than
   * as a missing reference — which would fail nearly every row of a sensible file.
   */
  managerDeferred?: boolean;
}

export interface ImportPreview {
  id: string;
  mode: ImportMode;
  fileName: string;
  rowCount: number;
  readyCount: number;
  errorCount: number;
  /** File-level refusals — a missing column, too many rows. Nothing is parsed past these. */
  fatal: string[];
  rows: ImportRowPreview[];
}

export interface ImportRowOutcome {
  row: number;
  workEmail: string;
  status: 'CREATED' | 'FAILED' | 'SKIPPED';
  employeeCode?: string;
  message?: string;
  invited?: boolean;
}

export interface ImportResult {
  id: string;
  status: ImportStatusCode;
  createdCount: number;
  failedCount: number;
  invitedCount: number;
  rows: ImportRowOutcome[];
}
