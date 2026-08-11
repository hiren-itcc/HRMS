import {
  cycleCloseSchema,
  goalCreateSchema,
  goalQuerySchema,
  goalUpdateSchema,
  reviewAcknowledgeSchema,
  reviewCycleCreateSchema,
  reviewCycleQuerySchema,
  reviewManagerSchema,
  reviewNoteSchema,
  reviewQuerySchema,
  reviewReassignSchema,
  reviewSelfSchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { GoalsService } from './goals.service';
import { ReviewCyclesService } from './review-cycles.service';
import { ReviewsService } from './reviews.service';

export class ReviewCycleCreateDto extends createZodDto(reviewCycleCreateSchema) {}
export class ReviewCycleQueryDto extends createZodDto(reviewCycleQuerySchema) {}
export class CycleCloseDto extends createZodDto(cycleCloseSchema) {}
export class GoalCreateDto extends createZodDto(goalCreateSchema) {}
export class GoalUpdateDto extends createZodDto(goalUpdateSchema) {}
export class GoalQueryDto extends createZodDto(goalQuerySchema) {}
export class ReviewQueryDto extends createZodDto(reviewQuerySchema) {}
export class ReviewSelfDto extends createZodDto(reviewSelfSchema) {}
export class ReviewManagerDto extends createZodDto(reviewManagerSchema) {}
export class ReviewAcknowledgeDto extends createZodDto(reviewAcknowledgeSchema) {}
export class ReviewNoteDto extends createZodDto(reviewNoteSchema) {}
export class ReviewReassignDto extends createZodDto(reviewReassignSchema) {}

/**
 * Goals, review cycles and reviews (docs/03-api-structure.md §performance).
 *
 * Read routes carry the weakest code that could reach them —
 * `performance.read.own` — and the service narrows from the token's scope,
 * because the guard cannot know whose review an id belongs to. The write routes
 * are the same shape: `performance.review.team` gets you to the handler, and
 * the service checks you are actually the named reviewer.
 *
 * Note what is *not* gated by a permission: writing your own self-assessment.
 * `performance.read.own` reaches it and the service checks you are the subject,
 * because being asked to assess yourself is a consequence of being enrolled in
 * a cycle, not a privilege somebody grants.
 */
@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
export class PerformanceController {
  constructor(
    private readonly cycles: ReviewCyclesService,
    private readonly goals: GoalsService,
    private readonly reviews: ReviewsService,
  ) {}

  // ── Cycles ──────────────────────────────────────────────────────────
  // Declared before the ':id' routes below so 'cycles' is never read as an id.

  @Get('cycles')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'Review cycles' })
  listCycles(@CurrentUser() user: AccessTokenClaims, @Query() query: ReviewCycleQueryDto) {
    return this.cycles.list(user, query);
  }

  @Get('cycles/active')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'The cycle currently running, if any' })
  activeCycle(@CurrentUser() user: AccessTokenClaims) {
    return this.cycles.active(user);
  }

  @Post('cycles')
  @RequirePermissions('performance.manage')
  @ApiOperation({ summary: 'Plan a cycle — created as a draft, nobody enrolled yet' })
  createCycle(@CurrentUser() user: AccessTokenClaims, @Body() body: ReviewCycleCreateDto) {
    return this.cycles.create(user, body);
  }

  @Get('cycles/:id')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'One cycle, with how far along it is' })
  getCycle(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.cycles.get(user, id);
  }

  @Patch('cycles/:id')
  @RequirePermissions('performance.manage')
  @ApiOperation({ summary: 'Edit a draft cycle' })
  updateCycle(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewCycleCreateDto,
  ) {
    return this.cycles.update(user, id, body);
  }

  @Post('cycles/:id/open')
  @RequirePermissions('performance.manage')
  @ApiOperation({ summary: 'Open it, enrolling everybody eligible. Safe to repeat' })
  openCycle(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.cycles.open(user, id);
  }

  @Post('cycles/:id/close')
  @RequirePermissions('performance.manage')
  @ApiOperation({ summary: 'Close it — refused with reviews outstanding unless forced' })
  closeCycle(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: CycleCloseDto,
  ) {
    return this.cycles.close(user, id, body);
  }

  @Delete('cycles/:id')
  @RequirePermissions('performance.manage')
  @ApiOperation({ summary: 'Delete a draft nobody has been enrolled in' })
  removeCycle(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.cycles.remove(user, id);
  }

  // ── Goals ───────────────────────────────────────────────────────────

  @Get('goals')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'Goals — own, team or everyone, per scope' })
  listGoals(@CurrentUser() user: AccessTokenClaims, @Query() query: GoalQueryDto) {
    return this.goals.list(user, query);
  }

  @Post('goals')
  @RequirePermissions('performance.goal.own')
  @ApiOperation({ summary: "Set a goal. Somebody else's needs performance.goal.team" })
  createGoal(@CurrentUser() user: AccessTokenClaims, @Body() body: GoalCreateDto) {
    return this.goals.create(user, body);
  }

  @Get('goals/:id')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'One goal' })
  getGoal(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.goals.get(user, id);
  }

  @Patch('goals/:id')
  @RequirePermissions('performance.goal.own')
  @ApiOperation({ summary: 'Edit it, including moving the progress on' })
  updateGoal(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: GoalUpdateDto,
  ) {
    return this.goals.update(user, id, body);
  }

  @Delete('goals/:id')
  @RequirePermissions('performance.goal.own')
  @ApiOperation({ summary: 'Remove a goal from an open cycle' })
  removeGoal(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.goals.remove(user, id);
  }

  // ── Reviews ─────────────────────────────────────────────────────────

  @Get('reviews')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'Reviews — own, team or everyone, per scope' })
  listReviews(@CurrentUser() user: AccessTokenClaims, @Query() query: ReviewQueryDto) {
    return this.reviews.list(user, query);
  }

  @Get('reviews/:id')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'One review, with that cycle’s goals beside it' })
  getReview(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.reviews.get(user, id);
  }

  @Patch('reviews/:id/self')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'Save the self-assessment. Still yours until submitted' })
  saveSelf(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewSelfDto,
  ) {
    return this.reviews.saveSelf(user, id, body);
  }

  @Post('reviews/:id/self/submit')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'Send it to whoever is reviewing you' })
  submitSelf(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewSelfDto,
  ) {
    return this.reviews.submitSelf(user, id, body);
  }

  @Post('reviews/:id/self/skip')
  @RequirePermissions('performance.manage')
  @ApiOperation({ summary: 'Move past a self-assessment nobody is going to write' })
  skipSelf(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewNoteDto,
  ) {
    return this.reviews.skipSelf(user, id, body);
  }

  @Patch('reviews/:id/manager')
  @RequirePermissions('performance.review.team')
  @ApiOperation({ summary: 'Save the manager half. Not visible to them yet' })
  saveManager(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewManagerDto,
  ) {
    return this.reviews.saveManager(user, id, body);
  }

  @Post('reviews/:id/share')
  @RequirePermissions('performance.review.team')
  @ApiOperation({ summary: 'Release it to the employee' })
  share(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewManagerDto,
  ) {
    return this.reviews.share(user, id, body);
  }

  @Post('reviews/:id/acknowledge')
  @RequirePermissions('performance.read.own')
  @ApiOperation({ summary: 'Say you have read it' })
  acknowledge(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewAcknowledgeDto,
  ) {
    return this.reviews.acknowledge(user, id, body);
  }

  @Post('reviews/:id/reopen')
  @RequirePermissions('performance.manage')
  @ApiOperation({ summary: 'Put a finished review back with its reviewer' })
  reopen(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewNoteDto,
  ) {
    return this.reviews.reopen(user, id, body);
  }

  @Post('reviews/:id/cancel')
  @RequirePermissions('performance.manage')
  @ApiOperation({ summary: 'Drop one person’s review — a leaver, a duplicate' })
  cancel(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewNoteDto,
  ) {
    return this.reviews.cancel(user, id, body);
  }

  @Post('reviews/:id/reassign')
  @RequirePermissions('performance.manage')
  @ApiOperation({ summary: 'Give it a different reviewer — no manager, or one who left' })
  reassign(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ReviewReassignDto,
  ) {
    return this.reviews.reassign(user, id, body);
  }
}
