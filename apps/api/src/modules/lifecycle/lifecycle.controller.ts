import type { AccessTokenClaims } from '@hrms/types';
import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { LifecycleService } from './lifecycle.service';

@ApiTags('lifecycle')
@ApiBearerAuth()
@Controller('lifecycle')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get('status')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'When the lifecycle tick last ran, and what it is configured to do' })
  status(@CurrentUser() user: AccessTokenClaims) {
    return this.lifecycle.status(user.orgId);
  }

  /**
   * A manual run.
   *
   * Two reasons it exists. One, somebody who has just changed the policy wants
   * it applied now rather than on the next sign-in. Two, it is the seam an
   * external scheduler can be pointed at later — a Render cron job or a
   * GitHub Actions workflow — with no code change, which matters because the
   * instance this runs on sleeps and cannot be relied on to fire a timer.
   */
  @Post('run')
  @RequirePermissions('settings.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the probation and notice-period checks now' })
  run(@CurrentUser() user: AccessTokenClaims) {
    return this.lifecycle.run(user.orgId, user.sub);
  }
}
