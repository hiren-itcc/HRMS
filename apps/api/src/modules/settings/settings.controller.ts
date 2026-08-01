import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { OrgSettingsPatchDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Deliberately ungated: every signed-in user needs `localization` to format
   * dates and `modules` to render navigation. Nothing here is sensitive —
   * these are org-wide display and policy defaults, not people data.
   */
  @Get()
  @ApiOperation({ summary: 'Organization settings, with defaults filled in' })
  get(@CurrentUser() user: AccessTokenClaims) {
    return this.settings.get(user.orgId);
  }

  @Patch()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Update one or more settings groups' })
  patch(@CurrentUser() user: AccessTokenClaims, @Body() dto: OrgSettingsPatchDto) {
    return this.settings.patch({ orgId: user.orgId, userId: user.sub }, dto);
  }
}
