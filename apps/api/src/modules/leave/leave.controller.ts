import type { AccessTokenClaims } from '@hrms/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  LeaveApplyDto,
  LeaveBalanceAdjustDto,
  LeaveBalanceQueryDto,
  LeaveCalendarQueryDto,
  LeaveDecisionDto,
  LeaveListQueryDto,
  LeavePreviewQueryDto,
  LeaveRequestQueryDto,
  LeaveTypeCreateDto,
  LeaveTypeUpdateDto,
} from './dto/leave.dto';
import { LeaveBalancesService } from './leave-balances.service';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveTypesService } from './leave-types.service';

@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave')
export class LeaveController {
  constructor(
    private readonly types: LeaveTypesService,
    private readonly balances: LeaveBalancesService,
    private readonly requests: LeaveRequestsService,
  ) {}

  // ── leave types ───────────────────────────────────────────────────────

  @Get('types')
  @ApiOperation({ summary: 'List leave types (everyone — needed to apply)' })
  listTypes(@CurrentUser() user: AccessTokenClaims, @Query() query: LeaveListQueryDto) {
    return this.types.list(user.orgId, query);
  }

  @Get('types/options')
  @ApiOperation({ summary: 'Flat leave-type list for the apply form' })
  typeOptions(@CurrentUser() user: AccessTokenClaims) {
    return this.types.options(user.orgId);
  }

  @Post('types')
  @RequirePermissions('leave.manage')
  @ApiOperation({ summary: 'Create a leave type' })
  createType(@CurrentUser() user: AccessTokenClaims, @Body() dto: LeaveTypeCreateDto) {
    return this.types.create({ orgId: user.orgId, userId: user.sub }, dto);
  }

  @Patch('types/:id')
  @RequirePermissions('leave.manage')
  @ApiOperation({ summary: 'Update a leave type' })
  updateType(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: LeaveTypeUpdateDto,
  ) {
    return this.types.update({ orgId: user.orgId, userId: user.sub }, id, dto);
  }

  @Delete('types/:id')
  @RequirePermissions('leave.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unused leave type' })
  removeType(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.types.remove({ orgId: user.orgId, userId: user.sub }, id);
  }

  // ── balances ──────────────────────────────────────────────────────────

  @Get('balances/me')
  @RequirePermissions('leave.read.own')
  @ApiOperation({ summary: 'Own balances for a year (provisioned on demand)' })
  async myBalances(@CurrentUser() user: AccessTokenClaims, @Query('year') year?: string) {
    const resolved = year ? Number(year) : await this.balances.currentYear(user.orgId);
    if (!user.employeeId) return { year: resolved, balances: [] };
    return this.balances.forEmployee(user.orgId, user.employeeId, resolved);
  }

  @Get('balances')
  @RequirePermissions('leave.read', 'leave.read.team')
  @ApiOperation({ summary: 'Balances across employees — org-wide or direct reports' })
  listBalances(@CurrentUser() user: AccessTokenClaims, @Query() query: LeaveBalanceQueryDto) {
    return this.balances.list(user, query);
  }

  @Post('balances/adjust')
  @RequirePermissions('leave.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set an allocation for one employee, type and year' })
  adjustBalance(@CurrentUser() user: AccessTokenClaims, @Body() dto: LeaveBalanceAdjustDto) {
    return this.balances.adjust(user, dto);
  }

  // ── requests ──────────────────────────────────────────────────────────

  @Get('requests/preview')
  @RequirePermissions('leave.request.own')
  @ApiOperation({ summary: 'Days a date range would cost (weekends/holidays excluded)' })
  preview(@CurrentUser() user: AccessTokenClaims, @Query() query: LeavePreviewQueryDto) {
    return this.requests.preview(user, query);
  }

  @Post('requests')
  @RequirePermissions('leave.request.own')
  @ApiOperation({ summary: 'Apply for leave (validates balance and overlaps)' })
  apply(@CurrentUser() user: AccessTokenClaims, @Body() dto: LeaveApplyDto) {
    return this.requests.apply(user, dto);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Leave requests — scope=own (default), inbox or all' })
  listRequests(@CurrentUser() user: AccessTokenClaims, @Query() query: LeaveRequestQueryDto) {
    return this.requests.list(user, query);
  }

  @Get('calendar')
  @ApiOperation({ summary: "Who's off this month (approved leave), scope-filtered" })
  calendar(@CurrentUser() user: AccessTokenClaims, @Query() query: LeaveCalendarQueryDto) {
    return this.requests.calendar(user, query.month);
  }

  @Post('requests/:id/approve')
  @RequirePermissions('leave.approve', 'leave.approve.team')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve leave — books the days against the balance' })
  approve(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: LeaveDecisionDto,
  ) {
    return this.requests.decide(user, id, 'APPROVED', dto);
  }

  @Post('requests/:id/reject')
  @RequirePermissions('leave.approve', 'leave.approve.team')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a leave request' })
  reject(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: LeaveDecisionDto,
  ) {
    return this.requests.decide(user, id, 'REJECTED', dto);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel own leave (releases booked days) or any as HR' })
  cancel(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.requests.cancel(user, id);
  }
}
