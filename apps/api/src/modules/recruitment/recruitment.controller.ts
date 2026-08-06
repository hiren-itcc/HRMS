import {
  applicationCreateSchema,
  applicationStageChangeSchema,
  candidateCreateSchema,
  candidateQuerySchema,
  candidateUpdateSchema,
  hireSchema,
  interviewCreateSchema,
  interviewFeedbackSchema,
  offerCreateSchema,
  offerRespondSchema,
  openingCreateSchema,
  openingQuerySchema,
  openingStatusChangeSchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RecruitmentService } from './recruitment.service';

export class OpeningCreateDto extends createZodDto(openingCreateSchema) {}
export class OpeningStatusChangeDto extends createZodDto(openingStatusChangeSchema) {}
export class OpeningQueryDto extends createZodDto(openingQuerySchema) {}
export class CandidateCreateDto extends createZodDto(candidateCreateSchema) {}
export class CandidateUpdateDto extends createZodDto(candidateUpdateSchema) {}
export class CandidateQueryDto extends createZodDto(candidateQuerySchema) {}
export class ApplicationCreateDto extends createZodDto(applicationCreateSchema) {}
export class ApplicationStageChangeDto extends createZodDto(applicationStageChangeSchema) {}
export class InterviewCreateDto extends createZodDto(interviewCreateSchema) {}
export class InterviewFeedbackDto extends createZodDto(interviewFeedbackSchema) {}
export class OfferCreateDto extends createZodDto(offerCreateSchema) {}
export class OfferRespondDto extends createZodDto(offerRespondSchema) {}
export class HireDto extends createZodDto(hireSchema) {}

/**
 * Recruitment.
 *
 * `recruitment.read` is the whole board and `recruitment.read.team` is a
 * hiring manager's own openings; both are accepted on the read routes and the
 * service narrows. The write codes are deliberately several rather than one —
 * raising an opening, adding a candidate, giving feedback, making an offer and
 * converting one into staff are five different jobs, and in most organizations
 * they are not all the same person's.
 *
 * Every static segment is declared before `:id`: Nest matches in declaration
 * order, so `candidates` arriving after `:id` would be swallowed by it.
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@Controller('recruitment')
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService) {}

  // ── candidates (static, before :id) ────────────────────────────────────

  @Get('candidates')
  @RequirePermissions('recruitment.read', 'recruitment.read.team')
  @ApiOperation({ summary: 'Everyone on file, newest first' })
  listCandidates(@CurrentUser() user: AccessTokenClaims, @Query() query: CandidateQueryDto) {
    return this.recruitment.listCandidates(user, query);
  }

  @Post('candidates')
  @RequirePermissions('recruitment.candidate.manage')
  @ApiOperation({ summary: 'Add somebody to the pool' })
  createCandidate(@CurrentUser() user: AccessTokenClaims, @Body() body: CandidateCreateDto) {
    return this.recruitment.createCandidate(user, body);
  }

  @Get('candidates/:id')
  @RequirePermissions('recruitment.read', 'recruitment.read.team')
  @ApiOperation({ summary: 'One person: applications, interviews and what was said' })
  candidate(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.recruitment.candidate(user, id);
  }

  @Patch('candidates/:id')
  @RequirePermissions('recruitment.candidate.manage')
  updateCandidate(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: CandidateUpdateDto,
  ) {
    return this.recruitment.updateCandidate(user, id, body);
  }

  // ── applications ───────────────────────────────────────────────────────

  @Post('applications')
  @RequirePermissions('recruitment.candidate.manage')
  @ApiOperation({ summary: 'Put a candidate forward for an opening' })
  apply(@CurrentUser() user: AccessTokenClaims, @Body() body: ApplicationCreateDto) {
    return this.recruitment.apply(user, body);
  }

  @Patch('applications/:id/stage')
  @RequirePermissions('recruitment.candidate.manage')
  @ApiOperation({ summary: 'Move an application along, or end it' })
  moveStage(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ApplicationStageChangeDto,
  ) {
    return this.recruitment.moveStage(user, id, body);
  }

  // ── interviews ─────────────────────────────────────────────────────────

  @Post('interviews')
  @RequirePermissions('recruitment.candidate.manage')
  @ApiOperation({ summary: 'Book a round' })
  scheduleInterview(@CurrentUser() user: AccessTokenClaims, @Body() body: InterviewCreateDto) {
    return this.recruitment.scheduleInterview(user, body);
  }

  @Patch('interviews/:id/feedback')
  @RequirePermissions('recruitment.interview.submit')
  @ApiOperation({ summary: 'Submit feedback — once; it freezes' })
  submitFeedback(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: InterviewFeedbackDto,
  ) {
    return this.recruitment.submitFeedback(user, id, body);
  }

  // ── offers ─────────────────────────────────────────────────────────────

  @Post('offers')
  @RequirePermissions('recruitment.offer.manage')
  @ApiOperation({ summary: 'Draft an offer against an application at the offer stage' })
  createOffer(@CurrentUser() user: AccessTokenClaims, @Body() body: OfferCreateDto) {
    return this.recruitment.createOffer(user, body);
  }

  @Get('offers/:id')
  @RequirePermissions('recruitment.read', 'recruitment.read.team')
  offer(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.recruitment.offer(user, id);
  }

  @Patch('offers/:id/send')
  @RequirePermissions('recruitment.offer.manage')
  @ApiOperation({ summary: 'Mark it sent' })
  sendOffer(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.recruitment.sendOffer(user, id);
  }

  @Patch('offers/:id/respond')
  @RequirePermissions('recruitment.offer.manage')
  @ApiOperation({ summary: 'Record what they said' })
  respondToOffer(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: OfferRespondDto,
  ) {
    return this.recruitment.respondToOffer(user, id, body);
  }

  /**
   * The conversion, and the only route in this module that creates a member of
   * staff. It runs through the same onboarding invite as every other new
   * starter — see the service — so it also spends `employee.invite`.
   */
  @Post('offers/:id/hire')
  @RequirePermissions('recruitment.hire')
  @ApiOperation({ summary: 'Turn an accepted offer into an invited new starter' })
  hire(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: HireDto) {
    return this.recruitment.hire(user, id, body);
  }

  // ── openings (the :id routes come last) ────────────────────────────────

  @Get()
  @RequirePermissions('recruitment.read', 'recruitment.read.team')
  @ApiOperation({ summary: 'Openings, with how many people are live in each pipeline' })
  listOpenings(@CurrentUser() user: AccessTokenClaims, @Query() query: OpeningQueryDto) {
    return this.recruitment.listOpenings(user, query);
  }

  @Post()
  @RequirePermissions('recruitment.opening.manage')
  createOpening(@CurrentUser() user: AccessTokenClaims, @Body() body: OpeningCreateDto) {
    return this.recruitment.createOpening(user, body);
  }

  @Get(':id')
  @RequirePermissions('recruitment.read', 'recruitment.read.team')
  @ApiOperation({ summary: 'One opening and its whole pipeline' })
  opening(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.recruitment.opening(user, id);
  }

  @Patch(':id')
  @RequirePermissions('recruitment.opening.manage')
  updateOpening(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: OpeningCreateDto,
  ) {
    return this.recruitment.updateOpening(user, id, body);
  }

  @Patch(':id/status')
  @RequirePermissions('recruitment.opening.manage')
  @ApiOperation({ summary: 'Publish, pause, close or fill — closing checks for live applications' })
  setStatus(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: OpeningStatusChangeDto,
  ) {
    return this.recruitment.setOpeningStatus(user, id, body);
  }
}
