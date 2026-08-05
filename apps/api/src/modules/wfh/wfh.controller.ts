import {
  wfhApplySchema,
  wfhDecisionSchema,
  wfhPreviewQuerySchema,
  wfhQuerySchema,
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
import { WfhService } from './wfh.service';

export class WfhApplyDto extends createZodDto(wfhApplySchema) {}
export class WfhDecisionDto extends createZodDto(wfhDecisionSchema) {}
export class WfhPreviewQueryDto extends createZodDto(wfhPreviewQuerySchema) {}
export class WfhQueryDto extends createZodDto(wfhQuerySchema) {}

/**
 * Working from home.
 *
 * Mirrors `leave.controller.ts` route for route, because the two are the same
 * shape of thing: an employee asks, their manager agrees, and the record is
 * what somebody points at afterwards.
 *
 * Which requests a `.team` holder may act on comes from `Employee.managerId`
 * inside the service, never from a query parameter.
 */
@ApiTags('wfh')
@ApiBearerAuth()
@Controller('wfh')
export class WfhController {
  constructor(private readonly wfh: WfhService) {}

  /**
   * Declared before `:id`, so "preview" and "me" are never read as request ids.
   *
   * Worth more here than the equivalent on leave: "that would be three days in
   * the week of 10 August, and you have two" is something to learn before
   * filing, not after.
   */
  @Get('preview')
  @RequirePermissions('wfh.request.own')
  @ApiOperation({ summary: 'Working days a range covers, and any week it would push over' })
  preview(@CurrentUser() user: AccessTokenClaims, @Query() query: WfhPreviewQueryDto) {
    return this.wfh.preview(user, query);
  }

  @Get('me')
  @RequirePermissions('wfh.read.own')
  @ApiOperation({ summary: 'My own requests' })
  mine(@CurrentUser() user: AccessTokenClaims, @Query() query: WfhQueryDto) {
    return this.wfh.list(user, { ...query, scope: 'own' });
  }

  @Get()
  @RequirePermissions('wfh.read', 'wfh.read.team', 'wfh.approve.team')
  @ApiOperation({ summary: 'Requests in scope — the inbox defaults to what is waiting' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: WfhQueryDto) {
    return this.wfh.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('wfh.read.own', 'wfh.read.team', 'wfh.read')
  @ApiOperation({ summary: 'One request' })
  detail(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.wfh.detail(user, id);
  }

  @Post()
  @RequirePermissions('wfh.request.own')
  @ApiOperation({ summary: 'Ask to work remotely on a range of days' })
  apply(@CurrentUser() user: AccessTokenClaims, @Body() body: WfhApplyDto) {
    return this.wfh.apply(user, body);
  }

  @Patch(':id')
  @RequirePermissions('wfh.request.own')
  @ApiOperation({ summary: 'Change your own request, while it is still pending' })
  amend(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: WfhApplyDto,
  ) {
    return this.wfh.amend(user, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('wfh.request.own', 'wfh.approve')
  @ApiOperation({ summary: 'Withdraw it — pending, or approved days still to come' })
  cancel(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.wfh.cancel(user, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('wfh.approve', 'wfh.approve.team')
  @ApiOperation({ summary: 'Agree the days' })
  approve(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: WfhDecisionDto,
  ) {
    return this.wfh.decide(user, id, true, body);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('wfh.approve', 'wfh.approve.team')
  @ApiOperation({ summary: 'Decline them, with a note' })
  reject(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: WfhDecisionDto,
  ) {
    return this.wfh.decide(user, id, false, body);
  }
}
