import { orgSettingsPatchSchema } from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class OrgSettingsPatchDto extends createZodDto(orgSettingsPatchSchema) {}
