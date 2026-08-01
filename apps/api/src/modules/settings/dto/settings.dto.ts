import { emailTemplateUpdateSchema, orgSettingsPatchSchema } from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class OrgSettingsPatchDto extends createZodDto(orgSettingsPatchSchema) {}

export class EmailTemplateUpdateDto extends createZodDto(emailTemplateUpdateSchema) {}
