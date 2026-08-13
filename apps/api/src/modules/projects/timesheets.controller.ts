import {
  timesheetDecisionSchema,
  timesheetQuerySchema,
  timesheetWeekQuerySchema,
  timesheetWeekSchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TimesheetsService } from './timesheets.service';

export class TimesheetQueryDto extends createZodDto(timesheetQuerySchema) {}
export class TimesheetWeekQueryDto extends createZodDto(timesheetWeekQuerySchema) {}
export class TimesheetWeekDto extends createZodDto(timesheetWeekSchema) {}
export class TimesheetDecisionDto extends createZodDto(timesheetDecisionSchema) {}

/**
 * Weekly timesheets (docs/03-api-structure.md §projects).
 *
 * Not nested under `/projects/:id`, because a week spans projects — nesting it
 * under one would make the resource lie about what it is. The web app still
 * shows it behind the Projects nav entry; the path and the screen do not have
 * to agree.
 *
 * Read routes carry `timesheet.read.own` and the service narrows from the
 * token's scope. An unreadable week answers 404, not 403.
 */
@ApiTags('timesheets')
@ApiBearerAuth()
@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  @Get()
  @RequirePermissions('timesheet.read.own')
  @ApiOperation({ summary: 'Weeks — mine, my team’s, or everyone’s' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: TimesheetQueryDto) {
    return this.timesheets.list(user, query);
  }

  /* Declared before ':id' so 'week' is not read as a timesheet id. */
  @Get('week')
  @RequirePermissions('timesheet.read.own')
  @ApiOperation({ summary: 'My week, and the projects I may log against in it' })
  week(@CurrentUser() user: AccessTokenClaims, @Query() query: TimesheetWeekQueryDto) {
    return this.timesheets.week(user, query.weekStart);
  }

  @Put('week')
  @RequirePermissions('timesheet.submit.own')
  @ApiOperation({ summary: 'Save the whole week, replacing what was there' })
  saveWeek(@CurrentUser() user: AccessTokenClaims, @Body() dto: TimesheetWeekDto) {
    return this.timesheets.saveWeek(user, dto);
  }

  @Get(':id')
  @RequirePermissions('timesheet.read.own')
  @ApiOperation({ summary: 'One week' })
  get(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.timesheets.get(user, id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('timesheet.submit.own')
  @ApiOperation({ summary: 'Send the week to my manager' })
  submit(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.timesheets.submit(user, id);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('timesheet.submit.own')
  @ApiOperation({ summary: 'Pull the week back before it is decided' })
  withdraw(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.timesheets.withdraw(user, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('timesheet.approve.team')
  @ApiOperation({ summary: 'Approve a week' })
  approve(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: TimesheetDecisionDto,
  ) {
    return this.timesheets.decide(user, id, 'APPROVED', dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('timesheet.approve.team')
  @ApiOperation({ summary: 'Send a week back, with a reason' })
  reject(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: TimesheetDecisionDto,
  ) {
    return this.timesheets.decide(user, id, 'REJECTED', dto);
  }
}
