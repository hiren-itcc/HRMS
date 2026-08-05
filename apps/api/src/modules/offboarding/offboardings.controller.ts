import {
  offboardingCancelSchema,
  offboardingCompleteSchema,
  offboardingCreateSchema,
  offboardingQuerySchema,
  offboardingUpdateSchema,
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
import { OffboardingsService } from './offboardings.service';

export class OffboardingCreateDto extends createZodDto(offboardingCreateSchema) {}
export class OffboardingUpdateDto extends createZodDto(offboardingUpdateSchema) {}
export class OffboardingCompleteDto extends createZodDto(offboardingCompleteSchema) {}
export class OffboardingCancelDto extends createZodDto(offboardingCancelSchema) {}
export class OffboardingQueryDto extends createZodDto(offboardingQuerySchema) {}

/**
 * Every route here is `employee.offboard`.
 *
 * No new permission code was added: that one already exists, is already
 * granted to exactly Admin and HR, and already means "may change whether this
 * person works here". A second code with the same grant list and the same
 * meaning would only be a synonym to keep in step.
 */
@ApiTags('offboarding')
@ApiBearerAuth()
@Controller('offboardings')
export class OffboardingsController {
  constructor(private readonly offboardings: OffboardingsService) {}

  @Get()
  @RequirePermissions('employee.offboard')
  @ApiOperation({ summary: 'Everyone leaving — serving notice, completed, or called off' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: OffboardingQueryDto) {
    return this.offboardings.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('employee.offboard')
  @ApiOperation({ summary: 'One offboarding, with its frozen snapshot' })
  detail(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.offboardings.detail(user, id);
  }

  @Post()
  @RequirePermissions('employee.offboard')
  @ApiOperation({
    summary: 'Start an exit directly — a termination, contract end or retirement',
  })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: OffboardingCreateDto) {
    return this.offboardings.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('employee.offboard')
  @ApiOperation({ summary: 'Move the last working date; the exit date moves with it' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: OffboardingUpdateDto,
  ) {
    return this.offboardings.update(user, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions('employee.offboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'They have left: suspends the sign-in and revokes every session' })
  complete(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: OffboardingCompleteDto,
  ) {
    return this.offboardings.complete({ orgId: user.orgId, userId: user.sub }, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('employee.offboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'They are staying: clears the exit date and restores the sign-in' })
  cancel(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: OffboardingCancelDto,
  ) {
    return this.offboardings.cancel(user, id, dto);
  }
}
