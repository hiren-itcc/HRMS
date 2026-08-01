import { Global, Module } from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Global because attendance, leave and reports all read organization policy
 * on their query paths — importing SettingsModule into each would be four
 * copies of the same wiring (docs/08 §settings registry).
 */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, EmailTemplatesService],
  exports: [SettingsService, EmailTemplatesService],
})
export class SettingsModule {}
