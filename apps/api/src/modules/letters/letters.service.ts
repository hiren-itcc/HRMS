import type { LetterIssueInput } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { render } from '../mail/template-renderer';
import { LetterTemplatesService } from './letter-templates.service';
import {
  bodyContainsSalary,
  buildLetterVars,
  type LetterSubject,
  missingVariables,
} from './letter-vars';

const SUBJECT_INCLUDE = {
  department: { select: { name: true } },
  designation: { select: { title: true } },
  location: { select: { name: true } },
  employmentType: { select: { name: true } },
  manager: { select: { firstName: true, lastName: true } },
} as const;

const LIST_SELECT = {
  id: true,
  templateKey: true,
  letterNumber: true,
  title: true,
  employeeName: true,
  employeeCode: true,
  containsSalary: true,
  status: true,
  issuedAt: true,
  voidedAt: true,
  voidReason: true,
} as const;

@Injectable()
export class LettersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: LetterTemplatesService,
  ) {}

  /**
   * Who may read a letter.
   *
   * The subject always may — they were handed the paper. Otherwise it takes
   * `letter.read`, and for a letter that quotes pay, `payroll.read` as well.
   *
   * Gating on the letter's own content rather than on the reader's role is
   * what makes this hold for a custom role composed in Settings: a role given
   * `letter.read` without `payroll.read` gets appointment and experience
   * letters and a 403 on offers and salary certificates, without anyone
   * having thought about that role in advance.
   */
  private assertCanRead(
    claims: AccessTokenClaims,
    letter: { employeeId: string; containsSalary: boolean },
  ): void {
    const perms = new Set(claims.perms);
    const isSubject = claims.employeeId === letter.employeeId;
    if (isSubject) return;

    if (!perms.has('letter.read')) throw new ForbiddenException('Not allowed to read this letter');
    if (letter.containsSalary && !perms.has('payroll.read')) {
      throw new ForbiddenException('This letter states salary and you cannot view pay data');
    }
  }

  /** The subject of a letter about to be issued — must be a live employee. */
  private async loadSubject(orgId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: orgId, deletedAt: null },
      include: SUBJECT_INCLUDE,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  /**
   * The salary in force on the issue date — not simply the newest row. A
   * future-dated increment must not leak into today's certificate, still less
   * announce a raise the employee has not been told about.
   */
  private async currentMonthlyCtc(employeeId: string, on: Date): Promise<number | null> {
    const row = await this.prisma.employeeSalary.findFirst({
      where: { employeeId, effectiveFrom: { lte: on } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row ? Number(row.monthlyCtc) : null;
  }

  /** `OFR/2026/0007` — sequential per template per year, per organization. */
  private async nextLetterNumber(orgId: string, prefix: string, key: string, year: number) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const count = await this.prisma.letter.count({
      where: { organizationId: orgId, templateKey: key, issuedAt: { gte: from, lt: to } },
    });
    return `${prefix}/${year}/${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Renders without persisting, so HR sees the real thing before committing
   * to it. `blockers` is what stops Issue being offered at all.
   */
  async preview(claims: AccessTokenClaims, input: LetterIssueInput) {
    const [employee, resolved] = await Promise.all([
      this.loadSubject(claims.orgId, input.employeeId),
      this.templates.resolve(claims.orgId, input.templateKey),
    ]);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: claims.orgId },
      select: { name: true },
    });
    const issuedBy = await this.prisma.employee.findFirst({
      where: { userId: claims.sub },
      select: { firstName: true, lastName: true },
    });

    const issueDate = new Date();
    const monthlyCtc = await this.currentMonthlyCtc(employee.id, issueDate);
    const containsSalary = bodyContainsSalary(resolved.template, resolved.bodyHtml);

    const vars = buildLetterVars(employee as LetterSubject, {
      orgName: org.name,
      letterNumber: `${resolved.template.numberPrefix}/${issueDate.getUTCFullYear()}/____`,
      issuedByName: issuedBy ? `${issuedBy.firstName} ${issuedBy.lastName}`.trim() : org.name,
      issueDate,
      monthlyCtc,
    });

    const blockers: string[] = [];
    if (containsSalary && monthlyCtc === null) {
      blockers.push(
        `No salary has been assigned to ${vars.employeeName} — this letter cannot quote a figure that does not exist.`,
      );
    }
    for (const name of missingVariables(input.templateKey, resolved.bodyHtml, vars)) {
      blockers.push(`The template uses {{${name}}}, which has no value for this employee.`);
    }

    return {
      title: render(resolved.title, vars),
      bodyHtml: render(resolved.bodyHtml, vars),
      containsSalary,
      blockers,
    };
  }

  /**
   * Freezes the rendered letter. Nothing here is re-rendered later: an issued
   * letter must read tomorrow exactly as it read on the day it was handed
   * over, the same rule payslips follow (docs/13-data-map.md).
   */
  async issue(claims: AccessTokenClaims, input: LetterIssueInput) {
    const perms = new Set(claims.perms);
    const [employee, resolved] = await Promise.all([
      this.loadSubject(claims.orgId, input.employeeId),
      this.templates.resolve(claims.orgId, input.templateKey),
    ]);
    const containsSalary = bodyContainsSalary(resolved.template, resolved.bodyHtml);
    if (containsSalary && !perms.has('payroll.read')) {
      throw new ForbiddenException('This letter states salary and you cannot view pay data');
    }

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: claims.orgId },
      select: { name: true },
    });
    const issuedBy = await this.prisma.employee.findFirst({
      where: { userId: claims.sub },
      select: { firstName: true, lastName: true },
    });

    const issueDate = new Date();
    const monthlyCtc = await this.currentMonthlyCtc(employee.id, issueDate);
    if (containsSalary && monthlyCtc === null) {
      throw new BadRequestException(
        `No salary has been assigned to ${employee.firstName} ${employee.lastName} — this letter cannot quote a figure that does not exist.`,
      );
    }

    const letterNumber = await this.nextLetterNumber(
      claims.orgId,
      resolved.template.numberPrefix,
      input.templateKey,
      issueDate.getUTCFullYear(),
    );
    const vars = buildLetterVars(employee as LetterSubject, {
      orgName: org.name,
      letterNumber,
      issuedByName: issuedBy ? `${issuedBy.firstName} ${issuedBy.lastName}`.trim() : org.name,
      issueDate,
      monthlyCtc,
    });

    const missing = missingVariables(input.templateKey, resolved.bodyHtml, vars);
    if (missing.length > 0) {
      throw new BadRequestException(
        `The template uses ${missing.map((n) => `{{${n}}}`).join(', ')}, which has no value for this employee.`,
      );
    }

    const letter = await this.prisma.letter.create({
      data: {
        organizationId: claims.orgId,
        employeeId: employee.id,
        templateKey: input.templateKey,
        letterNumber,
        title: render(resolved.title, vars),
        bodyHtml: render(resolved.bodyHtml, vars),
        employeeCode: employee.employeeCode,
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        departmentName: employee.department?.name ?? null,
        designationName: employee.designation?.title ?? null,
        joinDate: employee.joinDate,
        exitDate: employee.exitDate,
        monthlyCtc: containsSalary && monthlyCtc !== null ? monthlyCtc : null,
        containsSalary,
        variables: vars as Record<string, string>,
        issuedById: claims.sub,
      },
      select: LIST_SELECT,
    });

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'letter.issue',
      'Letter',
      letter.id,
      { templateKey: input.templateKey, letterNumber, employeeId: employee.id },
    );
    return letter;
  }

  /**
   * An employee's letters. Salary-bearing ones drop out for a reader who
   * cannot see pay — the same rule as reading one, applied to the list so it
   * does not advertise what it would then refuse.
   */
  async listForEmployee(claims: AccessTokenClaims, employeeId: string) {
    const perms = new Set(claims.perms);
    const isSubject = claims.employeeId === employeeId;
    if (!isSubject && !perms.has('letter.read')) {
      throw new ForbiddenException('Not allowed to read these letters');
    }
    const hideSalary = !isSubject && !perms.has('payroll.read');

    return this.prisma.letter.findMany({
      where: {
        organizationId: claims.orgId,
        employeeId,
        ...(hideSalary ? { containsSalary: false } : {}),
      },
      select: LIST_SELECT,
      orderBy: { issuedAt: 'desc' },
    });
  }

  /** The signed-in person's own letters, subject taken from the token. */
  async listMine(claims: AccessTokenClaims) {
    if (!claims.employeeId) return [];
    return this.prisma.letter.findMany({
      where: { organizationId: claims.orgId, employeeId: claims.employeeId },
      select: LIST_SELECT,
      orderBy: { issuedAt: 'desc' },
    });
  }

  async detail(claims: AccessTokenClaims, id: string) {
    const letter = await this.prisma.letter.findFirst({
      where: { id, organizationId: claims.orgId },
    });
    if (!letter) throw new NotFoundException('Letter not found');
    this.assertCanRead(claims, letter);
    return letter;
  }

  /**
   * Withdraws a letter without deleting it. The paper copy still exists, so
   * "we withdrew it, and here is why" is an answer where "it never existed"
   * is not. A void letter still renders, banner and all.
   */
  async void(claims: AccessTokenClaims, id: string, reason: string) {
    const letter = await this.prisma.letter.findFirst({
      where: { id, organizationId: claims.orgId },
      select: { id: true, status: true },
    });
    if (!letter) throw new NotFoundException('Letter not found');
    if (letter.status === 'VOID') throw new BadRequestException('This letter is already void');

    const updated = await this.prisma.letter.update({
      where: { id },
      data: {
        status: 'VOID',
        voidedAt: new Date(),
        voidedById: claims.sub,
        voidReason: reason,
      },
      select: LIST_SELECT,
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'letter.void',
      'Letter',
      id,
      { reason },
    );
    return updated;
  }
}
