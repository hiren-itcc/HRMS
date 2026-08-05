import type { AccessTokenClaims } from '@hrms/types';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

/**
 * One call for the landing page.
 *
 * **No `@RequirePermissions`, deliberately.** Every signed-in person has a
 * dashboard, and what they may see differs field by field rather than route by
 * route — a permission on the route would be either too strict to let an
 * employee load the page or too loose to mean anything. The service returns
 * null for each figure the caller may not see, which is the same shape
 * `/notifications` uses and for the same reason.
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Everything the dashboard shows, scoped to the caller' })
  summary(@CurrentUser() user: AccessTokenClaims) {
    return this.dashboard.summary(user);
  }
}
