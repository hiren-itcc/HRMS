import type {
  ApplicationCreateInput,
  ApplicationStageChangeInput,
  CandidateCreateInput,
  CandidateUpdateInput,
  HireInput,
  InterviewCreateInput,
  InterviewFeedbackInput,
  OfferCreateInput,
  OfferRespondInput,
  OpeningCreateInput,
  OpeningStatusChangeInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf, toDate } from '../../common/utils/calendar';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { ApplicationStage } from '../../generated/prisma/enums';
import { LifecyclePolicyService } from '../lifecycle/lifecycle-policy.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import {
  acceptsApplications,
  canCloseOpening,
  canMoveStage,
  canRaiseOffer,
  canRespondToOffer,
  isTerminal,
} from './application.stage';

/** Applications that have not ended. What "live" means for closing an opening. */
const LIVE_STAGES: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];

@Injectable()
export class RecruitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: OnboardingService,
    // Today is the organization's, not the server's — the same source every
    // other module here asks. A company in Mumbai closes an opening on their
    // date, not on UTC's.
    private readonly policy: LifecyclePolicyService,
  ) {}

  /**
   * What this person may see.
   *
   * `recruitment.read` is the whole board; `recruitment.read.team` is a hiring
   * manager's own openings. `'__none__'` for a manager with no employee record
   * is the sentinel every other team scope in this codebase uses — it matches
   * nothing, where an undefined would match everything.
   */
  private scope(claims: AccessTokenClaims): Prisma.JobOpeningWhereInput {
    const perms = new Set(claims.perms);
    if (perms.has('recruitment.read')) return { organizationId: claims.orgId };
    if (perms.has('recruitment.read.team')) {
      return { organizationId: claims.orgId, hiringManagerId: claims.employeeId ?? '__none__' };
    }
    throw new ForbiddenException('You cannot see recruitment');
  }

  private require(claims: AccessTokenClaims, code: string, why: string): void {
    if (!new Set(claims.perms).has(code)) throw new ForbiddenException(why);
  }

  // ── Openings ───────────────────────────────────────────────────────────

  async listOpenings(
    claims: AccessTokenClaims,
    query: { page: number; limit: number; status?: string; departmentId?: string; search?: string },
  ) {
    const where: Prisma.JobOpeningWhereInput = {
      ...this.scope(claims),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.jobOpening.findMany({
        where,
        include: {
          department: { select: { name: true } },
          location: { select: { name: true } },
          designation: { select: { title: true } },
          hiringManager: { select: { id: true, firstName: true, lastName: true } },
          // The number the list is actually read for: how many people are in
          // this pipeline right now, not how many ever applied.
          _count: { select: { applications: { where: { stage: { in: LIVE_STAGES } } } } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.jobOpening.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({ ...r, liveApplications: r._count.applications })),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async opening(claims: AccessTokenClaims, id: string) {
    const opening = await this.prisma.jobOpening.findFirst({
      where: { id, ...this.scope(claims) },
      include: {
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, title: true } },
        location: { select: { id: true, name: true } },
        employmentType: { select: { id: true, name: true } },
        hiringManager: { select: { id: true, firstName: true, lastName: true } },
        applications: {
          include: {
            candidate: true,
            offer: { select: { id: true, status: true, monthlyCtc: true } },
            _count: { select: { interviews: true } },
          },
          orderBy: { appliedOn: 'asc' },
        },
      },
    });
    if (!opening) throw new NotFoundException('No such opening');
    return opening;
  }

  async createOpening(claims: AccessTokenClaims, input: OpeningCreateInput) {
    this.require(claims, 'recruitment.opening.manage', 'You cannot raise openings');
    const created = await this.prisma.jobOpening.create({
      data: {
        organizationId: claims.orgId,
        title: input.title,
        departmentId: input.departmentId ?? null,
        designationId: input.designationId ?? null,
        locationId: input.locationId ?? null,
        employmentTypeId: input.employmentTypeId ?? null,
        hiringManagerId: input.hiringManagerId ?? null,
        headcount: input.headcount,
        description: input.description ?? null,
        minMonthlyCtc: input.minMonthlyCtc ?? null,
        maxMonthlyCtc: input.maxMonthlyCtc ?? null,
        createdById: claims.sub,
      },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'recruitment.opening.create',
      'JobOpening',
      created.id,
      { after: { title: created.title } },
    );
    return created;
  }

  async updateOpening(claims: AccessTokenClaims, id: string, input: OpeningCreateInput) {
    this.require(claims, 'recruitment.opening.manage', 'You cannot edit openings');
    await this.opening(claims, id);
    return this.prisma.jobOpening.update({
      where: { id },
      data: {
        title: input.title,
        departmentId: input.departmentId ?? null,
        designationId: input.designationId ?? null,
        locationId: input.locationId ?? null,
        employmentTypeId: input.employmentTypeId ?? null,
        hiringManagerId: input.hiringManagerId ?? null,
        headcount: input.headcount,
        description: input.description ?? null,
        minMonthlyCtc: input.minMonthlyCtc ?? null,
        maxMonthlyCtc: input.maxMonthlyCtc ?? null,
      },
    });
  }

  /**
   * Publishing, pausing and closing.
   *
   * Its own route because these carry rules a general edit would hide: closing
   * over live applications is refused, and the refusal names the alternative.
   */
  async setOpeningStatus(claims: AccessTokenClaims, id: string, input: OpeningStatusChangeInput) {
    this.require(claims, 'recruitment.opening.manage', 'You cannot change an opening');
    const { todayKey } = await this.policy.contextFor(claims.orgId);
    const opening = await this.opening(claims, id);

    if (input.status === 'CLOSED' || input.status === 'FILLED') {
      const live = await this.prisma.application.count({
        where: { openingId: id, stage: { in: LIVE_STAGES } },
      });
      const verdict = canCloseOpening(live);
      if (!verdict.ok) throw new BadRequestException(verdict.reason);
    }

    return this.prisma.jobOpening.update({
      where: { id },
      data: {
        status: input.status,
        openedOn:
          input.status === 'OPEN' && !opening.openedOn ? toDate(todayKey) : opening.openedOn,
        closedOn: input.status === 'CLOSED' || input.status === 'FILLED' ? toDate(todayKey) : null,
      },
    });
  }

  // ── Candidates ─────────────────────────────────────────────────────────

  async listCandidates(
    claims: AccessTokenClaims,
    query: { page: number; limit: number; search?: string },
  ) {
    this.scope(claims);
    const where: Prisma.CandidateWhereInput = {
      organizationId: claims.orgId,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.candidate.findMany({
        where,
        include: { _count: { select: { applications: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.candidate.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  async candidate(claims: AccessTokenClaims, id: string) {
    this.scope(claims);
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, organizationId: claims.orgId },
      include: {
        referrer: { select: { id: true, firstName: true, lastName: true } },
        applications: {
          include: {
            opening: { select: { id: true, title: true, status: true } },
            offer: true,
            interviews: {
              include: { interviewer: { select: { id: true, firstName: true, lastName: true } } },
              orderBy: { scheduledFor: 'asc' },
            },
          },
          orderBy: { appliedOn: 'desc' },
        },
      },
    });
    if (!candidate) throw new NotFoundException('No such candidate');
    return candidate;
  }

  async createCandidate(claims: AccessTokenClaims, input: CandidateCreateInput) {
    this.require(claims, 'recruitment.candidate.manage', 'You cannot add candidates');

    // Unique per organization on email. Caught here rather than as a raw P2002
    // so the answer is "they are already on file" and not a constraint name.
    const existing = await this.prisma.candidate.findUnique({
      where: { organizationId_email: { organizationId: claims.orgId, email: input.email } },
    });
    if (existing) {
      throw new BadRequestException(
        `${existing.firstName} ${existing.lastName} is already on file with that email — apply them to the opening instead.`,
      );
    }

    return this.prisma.candidate.create({
      data: {
        organizationId: claims.orgId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        currentEmployer: input.currentEmployer ?? null,
        currentTitle: input.currentTitle ?? null,
        noticePeriodDays: input.noticePeriodDays ?? null,
        expectedMonthlyCtc: input.expectedMonthlyCtc ?? null,
        source: input.source ?? null,
        referrerId: input.referrerId ?? null,
        notes: input.notes ?? null,
        createdById: claims.sub,
      },
    });
  }

  async updateCandidate(claims: AccessTokenClaims, id: string, input: CandidateUpdateInput) {
    this.require(claims, 'recruitment.candidate.manage', 'You cannot edit candidates');
    await this.candidate(claims, id);
    return this.prisma.candidate.update({ where: { id }, data: { ...input } });
  }

  // ── Applications ───────────────────────────────────────────────────────

  async apply(claims: AccessTokenClaims, input: ApplicationCreateInput) {
    this.require(claims, 'recruitment.candidate.manage', 'You cannot put candidates forward');

    const opening = await this.prisma.jobOpening.findFirst({
      where: { id: input.openingId, organizationId: claims.orgId },
    });
    if (!opening) throw new NotFoundException('No such opening');

    const accepts = acceptsApplications(opening.status);
    if (!accepts.ok) throw new BadRequestException(accepts.reason);

    const candidate = await this.prisma.candidate.findFirst({
      where: { id: input.candidateId, organizationId: claims.orgId },
    });
    if (!candidate) throw new NotFoundException('No such candidate');

    const already = await this.prisma.application.findUnique({
      where: { candidateId_openingId: { candidateId: candidate.id, openingId: opening.id } },
    });
    if (already) {
      throw new BadRequestException(
        `${candidate.firstName} has already applied to ${opening.title}.`,
      );
    }

    return this.prisma.application.create({
      data: {
        organizationId: claims.orgId,
        candidateId: candidate.id,
        openingId: opening.id,
      },
    });
  }

  /**
   * Moving an application, including ending it.
   *
   * The rules live in `application.stage.ts` and are asked here rather than
   * re-implemented — this method's job is to fetch what those rules need and
   * to write the answer down.
   */
  async moveStage(claims: AccessTokenClaims, id: string, input: ApplicationStageChangeInput) {
    this.require(claims, 'recruitment.candidate.manage', 'You cannot move applications');

    const application = await this.prisma.application.findFirst({
      where: { id, organizationId: claims.orgId },
      include: { offer: { select: { status: true } } },
    });
    if (!application) throw new NotFoundException('No such application');

    const verdict = canMoveStage({
      from: application.stage,
      to: input.stage,
      hasAcceptedOffer: application.offer?.status === 'ACCEPTED',
    });
    if (!verdict.ok) throw new BadRequestException(verdict.reason);

    const updated = await this.prisma.application.update({
      where: { id },
      data: {
        stage: input.stage,
        rejectionReason: input.stage === 'REJECTED' ? (input.rejectionReason ?? null) : null,
        rejectionNote: input.stage === 'REJECTED' ? (input.rejectionNote ?? null) : null,
        decidedAt: isTerminal(input.stage) ? new Date() : null,
      },
    });

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'recruitment.application.stage',
      'Application',
      id,
      { before: { stage: application.stage }, after: { stage: input.stage } },
    );
    return updated;
  }

  // ── Interviews ─────────────────────────────────────────────────────────

  async scheduleInterview(claims: AccessTokenClaims, input: InterviewCreateInput) {
    this.require(claims, 'recruitment.candidate.manage', 'You cannot schedule interviews');
    const application = await this.prisma.application.findFirst({
      where: { id: input.applicationId, organizationId: claims.orgId },
    });
    if (!application) throw new NotFoundException('No such application');
    if (isTerminal(application.stage)) {
      throw new BadRequestException('That application has already ended.');
    }

    return this.prisma.interview.create({
      data: {
        applicationId: application.id,
        interviewerId: input.interviewerId ?? null,
        scheduledFor: new Date(input.scheduledFor),
        durationMinutes: input.durationMinutes,
        mode: input.mode,
        round: input.round ?? null,
        createdById: claims.sub,
      },
    });
  }

  /**
   * Feedback, once.
   *
   * `submittedAt` is the freeze. The same rule as `Letter`'s body and
   * `Offboarding`'s snapshots, and for a sharper reason — a recommendation
   * that can be rewritten after the decision is evidence of nothing.
   */
  async submitFeedback(claims: AccessTokenClaims, id: string, input: InterviewFeedbackInput) {
    this.require(claims, 'recruitment.interview.submit', 'You cannot give interview feedback');

    const interview = await this.prisma.interview.findFirst({
      where: { id, application: { organizationId: claims.orgId } },
    });
    if (!interview) throw new NotFoundException('No such interview');
    if (interview.submittedAt) {
      throw new BadRequestException(
        'That feedback has been submitted. It cannot be edited — record a new interview if the view has changed.',
      );
    }
    if (interview.cancelledAt) throw new BadRequestException('That interview was cancelled.');

    return this.prisma.interview.update({
      where: { id },
      data: {
        recommendation: input.recommendation,
        notes: input.notes,
        submittedAt: new Date(),
      },
    });
  }

  // ── Offers ─────────────────────────────────────────────────────────────

  async createOffer(claims: AccessTokenClaims, input: OfferCreateInput) {
    this.require(claims, 'recruitment.offer.manage', 'You cannot make offers');

    const application = await this.prisma.application.findFirst({
      where: { id: input.applicationId, organizationId: claims.orgId },
      include: { offer: { select: { id: true } } },
    });
    if (!application) throw new NotFoundException('No such application');
    if (application.offer) throw new BadRequestException('This application already has an offer.');

    const verdict = canRaiseOffer(application.stage);
    if (!verdict.ok) throw new BadRequestException(verdict.reason);

    return this.prisma.offer.create({
      data: {
        organizationId: claims.orgId,
        applicationId: application.id,
        designationId: input.designationId ?? null,
        departmentId: input.departmentId ?? null,
        locationId: input.locationId ?? null,
        employmentTypeId: input.employmentTypeId ?? null,
        monthlyCtc: input.monthlyCtc,
        joinDate: toDate(input.joinDate),
        expiresOn: input.expiresOn ? toDate(input.expiresOn) : null,
        notes: input.notes ?? null,
        createdById: claims.sub,
      },
    });
  }

  async offer(claims: AccessTokenClaims, id: string) {
    this.scope(claims);
    const offer = await this.prisma.offer.findFirst({
      where: { id, organizationId: claims.orgId },
      include: {
        application: {
          include: { candidate: true, opening: { select: { id: true, title: true } } },
        },
        designation: { select: { id: true, title: true } },
        department: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        employmentType: { select: { id: true, name: true } },
        hiredEmployee: { select: { id: true, employeeCode: true } },
      },
    });
    if (!offer) throw new NotFoundException('No such offer');
    return offer;
  }

  async sendOffer(claims: AccessTokenClaims, id: string) {
    this.require(claims, 'recruitment.offer.manage', 'You cannot send offers');
    const offer = await this.offer(claims, id);
    if (offer.status !== 'DRAFT')
      throw new BadRequestException('That offer has already been sent.');
    return this.prisma.offer.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  async respondToOffer(claims: AccessTokenClaims, id: string, input: OfferRespondInput) {
    this.require(claims, 'recruitment.offer.manage', 'You cannot record an offer response');
    const offer = await this.offer(claims, id);

    const verdict = canRespondToOffer(offer.status);
    if (!verdict.ok) throw new BadRequestException(verdict.reason);

    const updated = await this.prisma.offer.update({
      where: { id },
      data: {
        status: input.status,
        respondedAt: new Date(),
        notes: input.notes ?? offer.notes,
      },
    });

    // A declined or withdrawn offer ends the application; an accepted one does
    // not, because the hire has not happened yet.
    if (input.status !== 'ACCEPTED') {
      await this.prisma.application.update({
        where: { id: offer.applicationId },
        data: {
          stage: 'REJECTED',
          rejectionReason: input.status === 'DECLINED' ? 'CANDIDATE_WITHDREW' : 'POSITION_CLOSED',
          rejectionNote: input.notes ?? null,
          decidedAt: new Date(),
        },
      });
    }

    return updated;
  }

  /**
   * The conversion. An accepted offer becomes a member of staff.
   *
   * **This does not create an employee.** It calls the same
   * `OnboardingService.onboard` that HR's *Onboard a hire* screen calls, which
   * already creates the Employee as ONBOARDING, an INVITED user with an
   * unusable password, the Onboarding record, and emails a single-use invite to
   * the **personal** address — because the work mailbox does not exist yet.
   *
   * Building a second path would have meant a second copy of employee-code
   * generation, of the unusable-password hash and of the audit entry, and one
   * of those three would have drifted.
   */
  async hire(claims: AccessTokenClaims, offerId: string, input: HireInput) {
    this.require(claims, 'recruitment.hire', 'You cannot convert an offer into an employee');
    /*
     * Stated rather than implied. Hiring spends `employee.invite` because it
     * creates a login; without this the caller would get onboard()'s refusal,
     * which is correct but reads as though the recruitment permission failed.
     */
    this.require(
      claims,
      'employee.invite',
      'Hiring creates their sign-in, so it also needs employee.invite',
    );

    const offer = await this.offer(claims, offerId);
    if (offer.status !== 'ACCEPTED') {
      throw new BadRequestException('Only an accepted offer can be converted.');
    }
    if (offer.hiredEmployeeId) {
      throw new BadRequestException('This offer has already been converted.');
    }

    const { candidate } = offer.application;
    const stage = canMoveStage({
      from: offer.application.stage,
      to: 'HIRED',
      hasAcceptedOffer: true,
    });
    if (!stage.ok) throw new BadRequestException(stage.reason);

    const { employee, inviteSent, inviteError } = await this.onboarding.onboard(claims, {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      personalEmail: candidate.email,
      workEmail: input.workEmail,
      // The date they agreed to, not today's guess.
      joinDate: dateKeyOf(offer.joinDate),
      employeeCode: input.employeeCode,
      departmentId: offer.departmentId ?? undefined,
      designationId: offer.designationId ?? undefined,
      locationId: offer.locationId ?? undefined,
      employmentTypeId: offer.employmentTypeId ?? undefined,
    });

    await this.prisma.$transaction([
      this.prisma.offer.update({
        where: { id: offerId },
        data: { hiredEmployeeId: employee.id },
      }),
      this.prisma.application.update({
        where: { id: offer.applicationId },
        data: { stage: 'HIRED', decidedAt: new Date() },
      }),
    ]);

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'recruitment.hire',
      'Offer',
      offerId,
      { after: { employeeId: employee.id, employeeCode: employee.employeeCode } },
    );

    // The invite outcome is passed through rather than swallowed: onboard()
    // deliberately does not fail the request when the mail does not send, and
    // the screen has to be able to say so and offer a resend.
    return { employee, inviteSent, inviteError };
  }
}
