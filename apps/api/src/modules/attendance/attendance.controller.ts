import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AttendanceService } from './attendance.service';
import { AttendanceRequestsService } from './attendance-requests.service';
import {
  ApprovalDecisionDto,
  AttendanceDayQueryDto,
  AttendanceRequestCreateDto,
  AttendanceRequestQueryDto,
  AttendanceSummaryQueryDto,
  ClockInDto,
  ClockOutDto,
  MyAttendanceQueryDto,
} from './dto/attendance.dto';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly requests: AttendanceRequestsService,
  ) {}

  // ── self service ──────────────────────────────────────────────────────

  @Post('check-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('attendance.mark.own')
  @ApiOperation({
    summary: 'Open a session — records the work mode and, if sent, where they are',
  })
  checkIn(@CurrentUser() user: AccessTokenClaims, @Body() dto: ClockInDto) {
    return this.attendance.checkIn(user, dto);
  }

  @Post('check-out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('attendance.mark.own')
  @ApiOperation({ summary: 'Close the running session (computes hours + half day)' })
  checkOut(@CurrentUser() user: AccessTokenClaims, @Body() dto: ClockOutDto) {
    return this.attendance.checkOut(user, dto);
  }

  @Get('today')
  @RequirePermissions('attendance.read.own')
  @ApiOperation({ summary: "Today's own attendance state, timezone and shift" })
  today(@CurrentUser() user: AccessTokenClaims) {
    return this.attendance.today(user);
  }

  @Get('me')
  @RequirePermissions('attendance.read.own')
  @ApiOperation({ summary: 'Own month — every day derived, plus monthly totals' })
  myMonth(@CurrentUser() user: AccessTokenClaims, @Query() query: MyAttendanceQueryDto) {
    return this.attendance.myMonth(user, query.month);
  }

  // ── team / org views ──────────────────────────────────────────────────

  @Get()
  @RequirePermissions('attendance.read', 'attendance.read.team')
  @ApiOperation({ summary: 'Day view — org-wide (HR) or direct reports (manager)' })
  dayView(@CurrentUser() user: AccessTokenClaims, @Query() query: AttendanceDayQueryDto) {
    return this.attendance.dayView(user, query);
  }

  @Get('summary')
  @RequirePermissions('attendance.read', 'attendance.read.team')
  @ApiOperation({ summary: 'Monthly totals per employee' })
  summary(@CurrentUser() user: AccessTokenClaims, @Query() query: AttendanceSummaryQueryDto) {
    return this.attendance.monthlySummary(user, query);
  }

  @Get('stats')
  @RequirePermissions('attendance.read', 'attendance.read.team')
  @ApiOperation({ summary: "Today's headline numbers for manager/HR dashboards" })
  stats(@CurrentUser() user: AccessTokenClaims) {
    return this.attendance.todayStats(user);
  }

  @Get('employees/:employeeId')
  @RequirePermissions('attendance.read', 'attendance.read.team')
  @ApiOperation({ summary: "One employee's month (HR/manager view)" })
  employeeMonth(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @Query() query: MyAttendanceQueryDto,
  ) {
    return this.attendance.monthForEmployee(user, employeeId, query.month);
  }

  // ── correction requests ───────────────────────────────────────────────

  @Post('requests')
  @RequirePermissions('attendance.request.own')
  @ApiOperation({ summary: 'Raise an attendance correction request' })
  createRequest(@CurrentUser() user: AccessTokenClaims, @Body() dto: AttendanceRequestCreateDto) {
    return this.requests.create(user, dto);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Correction requests — scope=own (default) or scope=inbox' })
  listRequests(@CurrentUser() user: AccessTokenClaims, @Query() query: AttendanceRequestQueryDto) {
    return this.requests.list(user, query);
  }

  @Post('requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('attendance.approve', 'attendance.approve.team')
  @ApiOperation({ summary: 'Approve a correction — updates the record in one transaction' })
  approve(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.requests.decide(user, id, 'APPROVED', dto);
  }

  @Post('requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('attendance.approve', 'attendance.approve.team')
  @ApiOperation({ summary: 'Reject a correction request' })
  reject(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.requests.decide(user, id, 'REJECTED', dto);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw your own pending request' })
  cancel(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.requests.cancel(user, id);
  }
}
