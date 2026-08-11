import {
  EMPLOYEE_IMPORT_COLUMNS,
  employeeCreateSchema,
  type ImportCommitInput,
  type ImportMode,
  type ImportPreview,
  type ImportResult,
  type ImportRowOutcome,
  type ImportRowPreview,
  type ImportRowProblem,
  MAX_IMPORT_ROWS,
  MAX_INVITES_PER_IMPORT,
  REQUIRED_IMPORT_HEADERS,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { parseSheet } from './csv-parse';
import {
  type ManagerCandidate,
  makeLookup,
  resolveManager,
  resolveRef,
} from './employee-import.resolve';
import { EmployeesService } from './employees.service';

/** A row after resolution — ids where the sheet had names. */
interface StagedRow {
  row: number;
  values: Record<string, string>;
  resolved: Record<string, unknown>;
  problems: ImportRowProblem[];
  managerDeferred: boolean;
  managerRef: string;
}

@Injectable()
export class EmployeeImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly onboarding: OnboardingService,
  ) {}

  /** The template, generated from the column list so it cannot drift from it. */
  template(): string {
    return `${EMPLOYEE_IMPORT_COLUMNS.map((c) => c.header).join(',')}\r\n`;
  }

  /**
   * Parse, resolve and validate — and write **nothing**.
   *
   * The whole point of the dry run: every error is found before any employee
   * exists, so a failure part-way through a commit can only be an
   * infrastructure fault, never bad data. That is what makes per-row commit
   * acceptable in §commit below.
   */
  async preview(
    claims: AccessTokenClaims,
    file: { originalname: string; buffer: Buffer },
    mode: ImportMode,
  ): Promise<ImportPreview> {
    const sheet = parseSheet(file.buffer.toString('utf8'));
    const fatal: string[] = [];

    const present = new Set(sheet.headers);
    const missing = REQUIRED_IMPORT_HEADERS.filter((h) => !present.has(h.toLowerCase()));
    if (missing.length) {
      // File-level, not per-row: every row would carry the same complaint, and
      // a thousand copies of it is not a more useful answer than one.
      fatal.push(`These columns are missing: ${missing.join(', ')}.`);
    }
    if (sheet.records.length === 0) fatal.push('That file has no rows in it.');
    if (sheet.records.length > MAX_IMPORT_ROWS) {
      fatal.push(
        `That file has ${sheet.records.length} rows and the limit is ${MAX_IMPORT_ROWS}. Split it and import in batches.`,
      );
    }

    if (fatal.length) {
      return {
        id: '',
        mode,
        fileName: file.originalname,
        rowCount: sheet.records.length,
        readyCount: 0,
        errorCount: sheet.records.length,
        fatal,
        rows: [],
      };
    }

    const staged = await this.stage(claims.orgId, sheet.records, mode);

    const record = await this.prisma.employeeImport.create({
      data: {
        organizationId: claims.orgId,
        uploadedById: claims.sub,
        fileName: file.originalname,
        rowCount: staged.length,
        mode,
        status: 'PREVIEW',
        rows: staged as unknown as object,
      },
    });

    const rows: ImportRowPreview[] = staged.map((r) => ({
      row: r.row,
      workEmail: String(r.resolved.workEmail ?? r.values['work email'] ?? ''),
      name: `${r.values['first name'] ?? ''} ${r.values['last name'] ?? ''}`.trim(),
      problems: r.problems,
      managerDeferred: r.managerDeferred || undefined,
    }));

    return {
      id: record.id,
      mode,
      fileName: file.originalname,
      rowCount: rows.length,
      readyCount: rows.filter((r) => r.problems.length === 0).length,
      errorCount: rows.filter((r) => r.problems.length > 0).length,
      fatal: [],
      rows,
    };
  }

  /** Load every lookup once for the whole file, not once per row. */
  private async stage(
    orgId: string,
    records: { row: number; values: Record<string, string> }[],
    mode: ImportMode,
  ): Promise<StagedRow[]> {
    const [departments, designations, locations, shifts, types, employees] = await Promise.all([
      this.prisma.department.findMany({ where: { organizationId: orgId } }),
      this.prisma.designation.findMany({ where: { organizationId: orgId } }),
      this.prisma.location.findMany({ where: { organizationId: orgId } }),
      this.prisma.shift.findMany({ where: { organizationId: orgId } }),
      this.prisma.employmentType.findMany({ where: { organizationId: orgId } }),
      this.prisma.employee.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          employeeCode: true,
          workEmail: true,
          firstName: true,
          lastName: true,
        },
      }),
    ]);

    const lookups = {
      department: makeLookup(departments, 'Department'),
      // Designations key on `title`, not `name`.
      designation: makeLookup(
        designations.map((d) => ({ id: d.id, name: d.title })),
        'Designation',
      ),
      location: makeLookup(locations, 'Location'),
      shift: makeLookup(shifts, 'Shift'),
      employmentType: makeLookup(types, 'Employment type'),
    };

    // Every work email in this file, so a manager named further down is
    // recognised as "later" rather than "missing".
    const emailsInFile = new Set(
      records.map((r) => (r.values['work email'] ?? '').trim().toLowerCase()).filter(Boolean),
    );

    return records.map((record) =>
      this.stageRow(record, lookups, employees as ManagerCandidate[], emailsInFile, mode),
    );
  }

  private stageRow(
    record: { row: number; values: Record<string, string> },
    lookups: Record<string, ReturnType<typeof makeLookup>>,
    existing: ManagerCandidate[],
    emailsInFile: Set<string>,
    mode: ImportMode,
  ): StagedRow {
    const get = (key: string) => (record.values[key] ?? '').trim();
    const problems: ImportRowProblem[] = [];

    const refs: Record<string, string> = {};
    for (const [column, lookupKey] of [
      ['Department', 'department'],
      ['Designation', 'designation'],
      ['Location', 'location'],
      ['Shift', 'shift'],
      ['Employment type', 'employmentType'],
    ] as const) {
      const lookup = lookups[lookupKey];
      if (!lookup) continue;
      const { id, problem } = resolveRef(get(column.toLowerCase()), lookup, column, true);
      if (problem) problems.push(problem);
      if (id) refs[`${lookupKey}Id`] = id;
    }

    const manager = resolveManager(get('manager'), existing, emailsInFile);
    if (manager.problem) problems.push(manager.problem);

    const candidate = {
      employeeCode: get('employee code') || undefined,
      firstName: get('first name'),
      lastName: get('last name'),
      workEmail: get('work email'),
      personalEmail: get('personal email') || undefined,
      phone: get('phone') || undefined,
      dateOfBirth: get('date of birth') || undefined,
      gender: get('gender') ? get('gender').toUpperCase() : undefined,
      uan: get('uan') || undefined,
      pan: get('pan') ? get('pan').toUpperCase() : undefined,
      esicIpNumber: get('esic ip number') || undefined,
      joinDate: get('join date'),
      managerId: manager.id ?? null,
      ...refs,
    };

    /*
     * The second pass, and the reason this cannot accept something the ordinary
     * create route would reject: the resolved object goes through the *same*
     * schema `POST /employees` uses.
     */
    const parsed = employeeCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '');
        // Report the column heading the person is looking at, not our field name.
        const column =
          EMPLOYEE_IMPORT_COLUMNS.find((c) => c.key === key || `${c.key}Id` === key)?.header ?? key;
        problems.push({
          column,
          message: issue.message,
          value: String(candidate[key as never] ?? ''),
        });
      }
    }

    // An invite has nowhere to go without a personal address, and the work one
    // does not exist yet for somebody who has not started.
    if (mode === 'INVITE' && !candidate.personalEmail) {
      problems.push({
        column: 'Personal email',
        message:
          'Required when inviting — the invite cannot go to a work address they cannot read yet',
      });
    }

    return {
      row: record.row,
      values: record.values,
      resolved: parsed.success ? parsed.data : candidate,
      problems,
      managerDeferred: !!manager.deferred,
      managerRef: get('manager'),
    };
  }

  /**
   * Create everybody, one at a time.
   *
   * **Sequential, never `Promise.all`.** `nextCode()` inside `onboard` has no
   * collision retry, so concurrent creation produces duplicate employee codes —
   * the single most likely production defect in this feature.
   *
   * **Per row, not one transaction.** Two hundred independent employees share
   * no invariant, and `onboard` cannot be correctly wrapped anyway: it runs its
   * own transaction and sends mail *after* it commits, deliberately, so that a
   * rollback can never hand out a working link to a user that no longer exists.
   * Nesting it would either break that or send 172 invites and then roll the
   * employees away — live invitations to accounts that do not exist.
   *
   * What makes that acceptable is the preview: nothing commits unless every row
   * was already clean, so a mid-run failure is infrastructure, not data.
   */
  async commit(
    claims: AccessTokenClaims,
    id: string,
    input: ImportCommitInput,
  ): Promise<ImportResult> {
    const record = await this.prisma.employeeImport.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!record) throw new NotFoundException('Import not found');
    if (record.status !== 'PREVIEW') {
      throw new BadRequestException(
        'This import has already been committed. Upload the file again to import more.',
      );
    }

    const staged = record.rows as unknown as StagedRow[];
    const blocked = staged.filter((r) => r.problems.length > 0);
    if (blocked.length) {
      throw new BadRequestException(
        `${blocked.length} row${blocked.length === 1 ? '' : 's'} still ${blocked.length === 1 ? 'has' : 'have'} problems. Fix the file and upload it again.`,
      );
    }

    const mode = record.mode as ImportMode;
    const sendInvites = mode === 'INVITE' && input.sendInvites;
    if (sendInvites && staged.length > MAX_INVITES_PER_IMPORT) {
      throw new BadRequestException(
        `That would email ${staged.length} people at once and the limit is ${MAX_INVITES_PER_IMPORT}. There is no undo for a sent invitation — split the file.`,
      );
    }

    const outcomes: ImportRowOutcome[] = [];
    const createdByEmail = new Map<string, string>();

    for (const staging of staged) {
      const resolved = staging.resolved as Record<string, unknown>;
      const workEmail = String(resolved.workEmail ?? '');
      try {
        const created = await this.createOne(claims, resolved, mode, sendInvites);
        createdByEmail.set(workEmail.toLowerCase(), created.id);
        outcomes.push({
          row: staging.row,
          workEmail,
          status: 'CREATED',
          employeeCode: created.employeeCode,
          invited: sendInvites,
        });
      } catch (err) {
        outcomes.push({
          row: staging.row,
          workEmail,
          status: 'FAILED',
          message: err instanceof Error ? err.message : 'Could not create this employee',
        });
      }
    }

    // Second pass: the managers who were further down the file.
    await this.linkDeferredManagers(claims, staged, createdByEmail);

    const createdCount = outcomes.filter((o) => o.status === 'CREATED').length;
    const failedCount = outcomes.filter((o) => o.status === 'FAILED').length;
    const status = failedCount === 0 ? 'COMMITTED' : createdCount === 0 ? 'FAILED' : 'PARTIAL';

    const updated = await this.prisma.employeeImport.update({
      where: { id },
      data: {
        status,
        committedAt: new Date(),
        createdCount,
        failedCount,
        invitedCount: sendInvites ? createdCount : 0,
        /*
         * Pruned to the outcome. The staged rows held names, dates of birth and
         * personal email addresses, and keeping them would be a second copy of
         * everybody's personal data with no retention story of its own.
         */
        rows: outcomes as unknown as object,
      },
    });

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'employee.import',
      'EmployeeImport',
      id,
      { after: { mode, createdCount, failedCount, invited: sendInvites } },
    );

    return {
      id: updated.id,
      status,
      createdCount,
      failedCount,
      invitedCount: updated.invitedCount,
      rows: outcomes,
    };
  }

  /**
   * Through the services that already exist, never `prisma.employee.create`.
   *
   * `RECORDS` uses `EmployeesService.create` with `createLogin: false` — the
   * backfill path, and the one with the employee-code collision retry.
   * `INVITE` uses `OnboardingService.onboard`, the same seam recruitment's hire
   * converts through, so code generation, the INVITED user and the invite stay
   * in one place. A third copy of any of that would drift.
   */
  private async createOne(
    claims: AccessTokenClaims,
    resolved: Record<string, unknown>,
    mode: ImportMode,
    sendInvites: boolean,
  ): Promise<{ id: string; employeeCode: string }> {
    if (mode === 'INVITE' && sendInvites) {
      const result = await this.onboarding.onboard(claims, resolved as never);
      const employee = (result as { employee?: { id: string; employeeCode: string } }).employee;
      return { id: employee?.id ?? '', employeeCode: employee?.employeeCode ?? '' };
    }
    const created = (await this.employees.create(claims, {
      ...resolved,
      createLogin: false,
    } as never)) as { id: string; employeeCode: string };
    return { id: created.id, employeeCode: created.employeeCode };
  }

  private async linkDeferredManagers(
    claims: AccessTokenClaims,
    staged: StagedRow[],
    createdByEmail: Map<string, string>,
  ): Promise<void> {
    for (const staging of staged.filter((r) => r.managerDeferred)) {
      const managerId = createdByEmail.get(staging.managerRef.trim().toLowerCase());
      const selfId = createdByEmail.get(
        String((staging.resolved as { workEmail?: string }).workEmail ?? '').toLowerCase(),
      );
      if (!managerId || !selfId) continue;
      await this.prisma.employee.update({
        where: { id: selfId },
        data: { managerId },
      });
    }
    if (staged.some((r) => r.managerDeferred)) {
      await auditMutation(
        this.prisma,
        { orgId: claims.orgId, userId: claims.sub },
        'employee.import.link_managers',
        'Employee',
        'bulk',
      );
    }
  }

  async get(claims: AccessTokenClaims, id: string): Promise<ImportResult> {
    const record = await this.prisma.employeeImport.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!record) throw new NotFoundException('Import not found');
    return {
      id: record.id,
      status: record.status as ImportResult['status'],
      createdCount: record.createdCount,
      failedCount: record.failedCount,
      invitedCount: record.invitedCount,
      rows: record.rows as unknown as ImportRowOutcome[],
    };
  }
}
