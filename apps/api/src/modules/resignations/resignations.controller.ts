import {
  resignationCreateSchema,
  resignationDecisionSchema,
  resignationQuerySchema,
  resignationWithdrawSchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  Body,
  Controller,
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
import { ResignationsService } from './resignations.service';

export class ResignationCreateDto extends createZodDto(resignationCreateSchema) {}
export class ResignationWithdrawDto extends createZodDto(resignationWithdrawSchema) {}
export class ResignationDecisionDto extends createZodDto(resignationDecisionSchema) {}
export class ResignationQueryDto extends createZodDto(resignationQuerySchema) {}

@ApiTags('resignations')
@ApiBearerAuth()
@Controller('resignations')
export class ResignationsController {
  constructor(private readonly resignations: ResignationsService) {}

  /*
   * Every write route here is `resignation.request.own`, and the employee is
   * taken from the JWT subject rather than from the body. There is no way to
   * file, edit or withdraw somebody else's resignation, by design: HR starting
   * an exit for somebody is an offboarding, which is a different verb with a
   * different permission and a different record.
   */

  @Get('me')
  @RequirePermissions('resignation.read.own')
  @ApiOperation({ summary: 'Every resignation the caller has filed, newest first' })
  mine(@CurrentUser() user: AccessTokenClaims) {
    return this.resignations.mine(user);
  }

  @Get('me/eligibility')
  @RequirePermissions('resignation.read.own')
  @ApiOperation({
    summary: 'Notice owed, earliest last working day, and whether one is already open',
  })
  eligibility(@CurrentUser() user: AccessTokenClaims) {
    return this.resignations.eligibility(user);
  }

  @Post()
  @RequirePermissions('resignation.request.own')
  @ApiOperation({ summary: 'File a resignation for yourself' })
  submit(@CurrentUser() user: AccessTokenClaims, @Body() dto: ResignationCreateDto) {
    return this.resignations.submit(user, dto);
  }

  @Get()
  @RequirePermissions('resignation.read', 'resignation.read.team')
  @ApiOperation({ summary: 'List resignations — org-wide (HR) or direct reports (manager)' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: ResignationQueryDto) {
    return this.resignations.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('resignation.read', 'resignation.read.team', 'resignation.read.own')
  @ApiOperation({ summary: 'One resignation, with its decisions' })
  detail(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.resignations.detail(user, id);
  }

  @Get(':id/activity')
  @RequirePermissions('resignation.read', 'resignation.read.team', 'resignation.read.own')
  @ApiOperation({ summary: 'The audit trail for this resignation, scoped to it' })
  activity(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.resignations.activity(user, id);
  }

  @Patch(':id')
  @RequirePermissions('resignation.request.own')
  @ApiOperation({ summary: 'Change your own request while it is still with you' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ResignationCreateDto,
  ) {
    return this.resignations.update(user, id, dto);
  }

  @Post(':id/withdraw')
  @RequirePermissions('resignation.request.own')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw your own resignation, until it is approved' })
  withdraw(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ResignationWithdrawDto,
  ) {
    return this.resignations.withdraw(user, id, dto);
  }

  /*
   * One route for both desks. Which one the caller is acting as comes from the
   * record's own status, never from the request — so the guard's `any-of` is
   * only the outer gate and the service still decides.
   */
  @Post(':id/decision')
  @RequirePermissions('resignation.approve', 'resignation.approve.team')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve, reject or send back — with remarks' })
  decide(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ResignationDecisionDto,
  ) {
    return this.resignations.decide(user, id, dto);
  }
}
