import {
  type EmployeeOnboardInput,
  ONBOARDING_DOCUMENTS,
  type OnboardingDocumentInput,
  type OnboardingProfileInput,
  type OnboardingQuery,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { InviteService } from '../auth/invite.service';
import { TokenService } from '../auth/token.service';
import { LifecyclePolicyService } from '../lifecycle/lifecycle-policy.service';

/** Column names on Onboarding, keyed by checklist slot. */
const SLOT_COLUMN = {
  idProof: 'idProofDocId',
  bankProof: 'bankProofDocId',
  education: 'educationDocId',
  prevEmployment: 'prevEmploymentDocId',
} as const;

const LIST_SELECT = {
  id: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewNote: true,
  hasPreviousEmployment: true,
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      workEmail: true,
      personalEmail: true,
      joinDate: true,
      status: true,
    },
  },
} as const;

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InviteService,
    private readonly tokens: TokenService,
    private readonly lifecycle: LifecyclePolicyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OnboardingService.name);
  }

  /**
   * Creates the employee, an invited login and the onboarding record, then
   * emails the invite.
   *
   * The mail is sent *after* the transaction commits, and a failure does not
   * fail the request. Sending inside the transaction would mean a rollback
   * could hand out a working link to a user that no longer exists; failing the
   * request would mean HR sees an error and re-submits, creating a second
   * employee. So: create, then try to send, and report honestly which happened.
   */
  async onboard(claims: AccessTokenClaims, input: EmployeeOnboardInput) {
    const perms = new Set(claims.perms);
    if (!perms.has('employee.invite')) {
      throw new ForbiddenException('You need employee.invite to invite a new hire');
    }

    // Employee.workEmail is not unique — only User.email is — so without this
    // the transaction dies on a raw P2002 with nothing useful to show HR.
    const taken = await this.prisma.user.findUnique({ where: { email: input.workEmail } });
    if (taken) throw new BadRequestException('That work email already has a sign-in');

    const role = await this.prisma.role.findUnique({
      where: { organizationId_code: { organizationId: claims.orgId, code: 'EMPLOYEE' } },
    });
    if (!role) throw new BadRequestException('No EMPLOYEE role exists in this organization');

    const passwordHash = await InviteService.unusablePasswordHash();

    const { employee, rawToken } = await this.prisma.$transaction(async (tx) => {
      const code = input.employeeCode?.trim() || (await this.nextCode(tx, claims.orgId));
      const created = await tx.employee.create({
        data: {
          organizationId: claims.orgId,
          employeeCode: code,
          firstName: input.firstName,
          lastName: input.lastName,
          workEmail: input.workEmail,
          personalEmail: input.personalEmail,
          joinDate: new Date(input.joinDate),
          status: 'ONBOARDING',
          departmentId: input.departmentId || null,
          designationId: input.designationId || null,
          locationId: input.locationId || null,
          shiftId: input.shiftId || null,
          employmentTypeId: input.employmentTypeId || null,
          managerId: input.managerId || null,
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: claims.orgId,
          email: input.workEmail,
          passwordHash,
          // login() already refuses anything but ACTIVE, so this gates itself.
          status: 'INVITED',
          mustChangePassword: false,
          roleId: role.id,
        },
      });
      await tx.employee.update({ where: { id: created.id }, data: { userId: user.id } });
      await tx.onboarding.create({ data: { employeeId: created.id } });

      const raw = await this.invites.mint(tx, {
        employeeId: created.id,
        sentToEmail: input.personalEmail,
        createdById: claims.sub,
      });
      return { employee: created, rawToken: raw };
    });

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'employee.onboard',
      'Employee',
      employee.id,
      { after: { employeeCode: employee.employeeCode, invitedTo: input.personalEmail } },
    );

    const invite = await this.trySend(claims, employee, rawToken, input.personalEmail);
    return { employee, inviteSent: invite.sent, inviteError: invite.error };
  }

  /** Re-issues an invitation. The previous link dies (docs/07). */
  async resendInvite(claims: AccessTokenClaims, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: claims.orgId, deletedAt: null },
      include: { user: { select: { status: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    /*
     * Only an account that has never been used may be re-invited. Without this
     * check, re-invite against an ACTIVE user would be an unauthenticated
     * password reset that HR could aim at any account in the organization.
     */
    if (employee.user?.status !== 'INVITED') {
      throw new BadRequestException('This account has already been set up');
    }
    if (!employee.personalEmail) {
      throw new BadRequestException('No personal email is on file to send the invitation to');
    }

    const rawToken = await this.prisma.$transaction((tx) =>
      this.invites.mint(tx, {
        employeeId: employee.id,
        sentToEmail: employee.personalEmail as string,
        createdById: claims.sub,
      }),
    );
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'employee.invite_resent',
      'Employee',
      employee.id,
    );
    const invite = await this.trySend(claims, employee, rawToken, employee.personalEmail);
    return { inviteSent: invite.sent, inviteError: invite.error };
  }

  /**
   * The invitation state for one employee — what HR needs to answer "did they
   * get it?" three weeks later. Returns null for anyone not mid-onboarding, so
   * the card simply does not render for an ordinary employee.
   */
  async inviteStatus(claims: AccessTokenClaims, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: claims.orgId, deletedAt: null },
      select: {
        personalEmail: true,
        status: true,
        user: { select: { status: true } },
        onboarding: { select: { id: true, status: true } },
        invites: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { sentToEmail: true, expiresAt: true, usedAt: true, createdAt: true },
        },
      },
    });
    if (!employee?.onboarding) return null;

    const latest = employee.invites[0];
    return {
      onboardingId: employee.onboarding.id,
      onboardingStatus: employee.onboarding.status,
      /** Only an unused account can be re-invited — see resendInvite. */
      canResend: employee.user?.status === 'INVITED',
      accepted: employee.user?.status === 'ACTIVE',
      personalEmail: employee.personalEmail,
      lastSentTo: latest?.sentToEmail ?? null,
      lastSentAt: latest?.createdAt ?? null,
      expiresAt: latest?.expiresAt ?? null,
      expired: latest ? latest.expiresAt < new Date() && !latest.usedAt : false,
    };
  }

  /** The wizard's own view of itself. */
  async mine(claims: AccessTokenClaims) {
    const record = await this.requireOwn(claims);
    return this.present(record);
  }

  /**
   * Gate for a write that another service performs — bank details go through
   * EmployeesService so the audit action stays single, but the *permission* to
   * write them here is the onboarding state, not `employee.update`.
   */
  async assertOwnAndEditable(claims: AccessTokenClaims): Promise<void> {
    this.assertEditable((await this.requireOwn(claims)).status);
  }

  /** Personal details. Accepted only while the record is still IN_PROGRESS. */
  async updateMine(claims: AccessTokenClaims, input: OnboardingProfileInput) {
    const record = await this.requireOwn(claims);
    this.assertEditable(record.status);

    const { hasPreviousEmployment, dateOfBirth, ...employeeFields } = input;
    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id: record.employeeId },
        data: {
          ...employeeFields,
          ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
        },
      }),
      this.prisma.onboarding.update({
        where: { id: record.id },
        data: { ...(hasPreviousEmployment === undefined ? {} : { hasPreviousEmployment }) },
      }),
    ]);
    return this.present(await this.requireOwn(claims));
  }

  /** Files an uploaded document against a checklist slot. */
  async attachDocument(claims: AccessTokenClaims, input: OnboardingDocumentInput) {
    const record = await this.requireOwn(claims);
    this.assertEditable(record.status);

    const doc = await this.prisma.document.findFirst({
      where: {
        id: input.documentId,
        organizationId: claims.orgId,
        employeeId: record.employeeId,
        deletedAt: null,
      },
    });
    if (!doc) throw new NotFoundException('Document not found');

    await this.prisma.onboarding.update({
      where: { id: record.id },
      data: { [SLOT_COLUMN[input.slot]]: doc.id },
    });
    return this.present(await this.requireOwn(claims));
  }

  /**
   * Hands the record to HR.
   *
   * A conditional update rather than a plain one: two tabs submitting at once
   * would otherwise both "succeed" and overwrite `submittedAt`.
   */
  async submit(claims: AccessTokenClaims) {
    const record = await this.requireOwn(claims);
    this.assertEditable(record.status);

    const missing = this.missingItems(record);
    if (missing.length > 0) {
      throw new BadRequestException(`Still needed: ${missing.join(', ')}`);
    }

    const moved = await this.prisma.onboarding.updateMany({
      where: { id: record.id, status: 'IN_PROGRESS' },
      data: { status: 'SUBMITTED', submittedAt: new Date(), reviewNote: null },
    });
    if (moved.count !== 1) throw new ConflictException('This has already been submitted');

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'onboarding.submit',
      'Onboarding',
      record.id,
    );
    return this.present(await this.requireOwn(claims));
  }

  /** HR's queue. */
  async list(claims: AccessTokenClaims, query: OnboardingQuery) {
    const where = {
      employee: { organizationId: claims.orgId, deletedAt: null },
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.onboarding.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.onboarding.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async detail(claims: AccessTokenClaims, id: string) {
    const record = await this.prisma.onboarding.findFirst({
      where: { id, employee: { organizationId: claims.orgId } },
      include: { employee: { include: { bankDetail: true } } },
    });
    if (!record) throw new NotFoundException('Onboarding record not found');
    return record;
  }

  /**
   * Approval is the moment somebody becomes staff, so it validates the job
   * details HR was allowed to defer at invite time. Nothing reaches ACTIVE
   * half-specified.
   */
  async approve(claims: AccessTokenClaims, id: string) {
    const record = await this.detail(claims, id);
    if (record.status !== 'SUBMITTED') {
      throw new ConflictException('Only a submitted onboarding can be approved');
    }

    const missingJob = (
      [
        ['departmentId', 'department'],
        ['designationId', 'designation'],
        ['locationId', 'location'],
        ['shiftId', 'shift'],
        ['employmentTypeId', 'employment type'],
      ] as const
    )
      .filter(([field]) => !record.employee[field])
      .map(([, label]) => label);
    if (missingJob.length > 0) {
      throw new BadRequestException(
        `Set the ${missingJob.join(', ')} on the employee record before approving`,
      );
    }

    const moved = await this.prisma.onboarding.updateMany({
      where: { id, status: 'SUBMITTED' },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedById: claims.sub,
        reviewNote: null,
      },
    });
    if (moved.count !== 1) throw new ConflictException('This has already been reviewed');

    /*
     * Approval is the moment a hire starts, so it is also the moment their
     * probation clock starts — not the invite, which they may never accept.
     * Dated from their join date rather than from today, because that is what
     * the offer says and payroll already uses it.
     */
    const lifecycleCtx = await this.lifecycle.contextFor(claims.orgId);
    const probationEndDate = this.lifecycle.probationEnd(
      dateKeyOf(record.employee.joinDate),
      record.employee.probationMonths,
      lifecycleCtx,
    );

    await this.prisma.employee.update({
      where: { id: record.employeeId },
      data: {
        status: 'ACTIVE',
        probationEndDate,
        confirmedOn: probationEndDate ? null : record.employee.joinDate,
      },
    });

    /*
     * Their access token still carries `onboarding: true`, and the guard reads
     * the claim rather than the database. Revoking the sessions forces a
     * refresh, which mints a token without it — the same move changeRole makes
     * for the same reason.
     */
    if (record.employee.userId) await this.tokens.revokeAllForUser(record.employee.userId);

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'onboarding.approve',
      'Onboarding',
      id,
      { employeeId: record.employeeId },
    );
    return this.present(await this.detail(claims, id));
  }

  /** Sends it back with a note; the employee can edit again. */
  async requestChanges(claims: AccessTokenClaims, id: string, note: string) {
    const record = await this.detail(claims, id);
    const moved = await this.prisma.onboarding.updateMany({
      where: { id, status: 'SUBMITTED' },
      data: {
        status: 'IN_PROGRESS',
        reviewedAt: new Date(),
        reviewedById: claims.sub,
        reviewNote: note,
      },
    });
    if (moved.count !== 1)
      throw new ConflictException('Only a submitted onboarding can be returned');

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'onboarding.changes_requested',
      'Onboarding',
      id,
      { note },
    );
    return this.present(await this.detail(claims, record.id));
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async requireOwn(claims: AccessTokenClaims) {
    if (!claims.employeeId) throw new NotFoundException('No employee record for this account');
    const record = await this.prisma.onboarding.findUnique({
      where: { employeeId: claims.employeeId },
      include: { employee: { include: { bankDetail: true } } },
    });
    if (!record) throw new NotFoundException('You have no onboarding to complete');
    return record;
  }

  /**
   * The one check the JWT claim cannot make. An approved employee reaching
   * these endpoints must be refused, or they could keep rewriting their own
   * bank details — with no HR review — long after onboarding ended.
   */
  private assertEditable(status: string): void {
    if (status !== 'IN_PROGRESS') {
      throw new ForbiddenException('Your onboarding is no longer open for changes');
    }
  }

  /** Checklist items still outstanding, in words HR and the hire both read. */
  private missingItems(record: {
    hasPreviousEmployment: boolean | null;
    idProofDocId: string | null;
    bankProofDocId: string | null;
    educationDocId: string | null;
    prevEmploymentDocId: string | null;
    employee: { dateOfBirth: Date | null; bankDetail: unknown | null };
  }): string[] {
    const missing: string[] = [];
    if (!record.employee.dateOfBirth) missing.push('date of birth');
    if (!record.employee.bankDetail) missing.push('bank details');
    if (record.hasPreviousEmployment === null) {
      missing.push('whether this is your first job');
    }

    for (const item of ONBOARDING_DOCUMENTS) {
      const filled = record[`${SLOT_COLUMN[item.slot]}` as keyof typeof record];
      // The relieving letter is required only of someone who says they have
      // worked before — a declaration, not a silent waiver.
      if (item.slot === 'prevEmployment' && record.hasPreviousEmployment !== true) continue;
      if (!filled) missing.push(item.label.toLowerCase());
    }
    return missing;
  }

  /** Adds the outstanding-items list the wizard drives its steps from. */
  private present<T extends Parameters<OnboardingService['missingItems']>[0]>(record: T) {
    return { ...record, missing: this.missingItems(record) };
  }

  /**
   * Sends, and reports *why* if it fails.
   *
   * The reason matters more than the fact here: by far the commonest failure
   * is the provider refusing the recipient (an unverified sending domain), and
   * "the invitation did not go out" sends HR looking for a bug in the product
   * instead of at the one sentence that explains it.
   */
  private async trySend(
    claims: AccessTokenClaims,
    employee: { id: string; firstName: string; workEmail: string },
    rawToken: string,
    to: string,
  ): Promise<{ sent: boolean; error?: string }> {
    try {
      const inviter = await this.prisma.employee.findFirst({
        where: { userId: claims.sub },
        select: { firstName: true, lastName: true },
      });
      await this.invites.send({
        to,
        rawToken,
        firstName: employee.firstName,
        workEmail: employee.workEmail,
        inviterName: inviter ? `${inviter.firstName} ${inviter.lastName}`.trim() : 'Your HR team',
        orgId: claims.orgId,
      });
      return { sent: true };
    } catch (error) {
      // Never fatal: the employee exists and is correct, and HR can resend.
      this.logger.error({ err: error, employeeId: employee.id }, 'Invitation email failed');
      return { sent: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** EMP-0001 upward, from the highest existing code rather than a row count. */
  private async nextCode(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
    const last = await tx.employee.findFirst({
      where: { organizationId: orgId, employeeCode: { startsWith: 'EMP-' } },
      orderBy: { employeeCode: 'desc' },
      select: { employeeCode: true },
    });
    const n = last ? Number.parseInt(last.employeeCode.slice(4), 10) + 1 : 1;
    return `EMP-${String(n).padStart(4, '0')}`;
  }
}
