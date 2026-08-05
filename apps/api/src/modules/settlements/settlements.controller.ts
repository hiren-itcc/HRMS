import {
  settlementApproveSchema,
  settlementCancelSchema,
  settlementCreateSchema,
  settlementLineCreateSchema,
  settlementLineUpdateSchema,
  settlementPaySchema,
  settlementQuerySchema,
} from '@hrms/shared';
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
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SettlementsService } from './settlements.service';

export class SettlementCreateDto extends createZodDto(settlementCreateSchema) {}
export class SettlementLineCreateDto extends createZodDto(settlementLineCreateSchema) {}
export class SettlementLineUpdateDto extends createZodDto(settlementLineUpdateSchema) {}
export class SettlementApproveDto extends createZodDto(settlementApproveSchema) {}
export class SettlementPayDto extends createZodDto(settlementPaySchema) {}
export class SettlementCancelDto extends createZodDto(settlementCancelSchema) {}
export class SettlementQueryDto extends createZodDto(settlementQuerySchema) {}

/**
 * Mounted under `/payroll`, and not under `/offboardings`.
 *
 * Finance holds `payroll.approve` and `payroll.pay` but not
 * `employee.offboard`. Routing settlements through the exit record would have
 * meant granting Finance read access to every offboarding in the company just
 * so they could release one payment.
 *
 * No new permission codes either. `payroll.process` prepares and edits,
 * `payroll.approve` approves, `payroll.pay` releases — that is the separation
 * of duties payroll already runs on, and it fits this exactly: HR prepares the
 * settlement, Finance releases the money.
 *
 * `/payroll/settlements` is free of any ordering hazard: every other route
 * under `/payroll` is a static prefix, so nothing here shadows a `:id`.
 */
@ApiTags('settlements')
@ApiBearerAuth()
@Controller('payroll/settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'Every settlement — draft, approved, paid or cancelled' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: SettlementQueryDto) {
    return this.settlements.list(user, query);
  }

  /**
   * Declared before `:id` so "for-offboarding" is never read as a settlement
   * id. Nest matches in declaration order and a static segment that arrives
   * second loses to the parameter above it.
   */
  @Get('for-offboarding/:offboardingId')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: "One exit's settlement, or null if none was prepared" })
  forOffboarding(
    @CurrentUser() user: AccessTokenClaims,
    @Param('offboardingId') offboardingId: string,
  ) {
    return this.settlements.forOffboarding(user, offboardingId);
  }

  @Get(':id')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'One settlement, with every line and its basis' })
  detail(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.settlements.detail(user, id);
  }

  @Get(':id/activity')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'Who computed, changed, approved and paid it' })
  activity(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.settlements.activity(user, id);
  }

  @Post()
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Prepare the settlement for an exit' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() body: SettlementCreateDto) {
    return this.settlements.create(user, body);
  }

  @Post(':id/recompute')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Work the figures out again — destructive, drafts only' })
  recompute(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.settlements.recompute(user, id);
  }

  @Post(':id/lines')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Add a line by hand' })
  addLine(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: SettlementLineCreateDto,
  ) {
    return this.settlements.addLine(user, id, body);
  }

  @Patch(':id/lines/:lineId')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Override a computed figure' })
  updateLine(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: SettlementLineUpdateDto,
  ) {
    return this.settlements.updateLine(user, id, lineId, body);
  }

  @Delete(':id/lines/:lineId')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Take a line off the statement' })
  removeLine(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.settlements.removeLine(user, id, lineId);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll.approve')
  @ApiOperation({ summary: 'Agree the figures. Nothing can be edited afterwards' })
  approve(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: SettlementApproveDto,
  ) {
    return this.settlements.approve(user, id, body);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll.pay')
  @ApiOperation({ summary: 'Record the payment against a bank reference' })
  pay(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: SettlementPayDto,
  ) {
    return this.settlements.pay(user, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll.approve')
  @ApiOperation({ summary: 'Call it off, with a reason. The record stays' })
  cancel(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: SettlementCancelDto,
  ) {
    return this.settlements.cancel(user, id, body);
  }
}
