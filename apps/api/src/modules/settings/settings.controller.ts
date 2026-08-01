import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Delete, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EmailTemplateUpdateDto, OrgSettingsPatchDto } from './dto/settings.dto';
import { EmailTemplatesService } from './email-templates.service';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly emailTemplates: EmailTemplatesService,
  ) {}

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

  // ── email templates ───────────────────────────────────────────────────

  @Get('email-templates')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'System email templates, merged with the shipped defaults' })
  listTemplates(@CurrentUser() user: AccessTokenClaims) {
    return this.emailTemplates.list(user);
  }

  @Put('email-templates/:key')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Edit an email template' })
  updateTemplate(
    @CurrentUser() user: AccessTokenClaims,
    @Param('key') key: string,
    @Body() dto: EmailTemplateUpdateDto,
  ) {
    return this.emailTemplates.update(user, key, dto);
  }

  @Delete('email-templates/:key')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Discard the edit and return to the shipped default' })
  resetTemplate(@CurrentUser() user: AccessTokenClaims, @Param('key') key: string) {
    return this.emailTemplates.reset(user, key);
  }
}
