import {
  announcementCreateSchema,
  announcementQuerySchema,
  announcementUpdateSchema,
} from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class AnnouncementQueryDto extends createZodDto(announcementQuerySchema) {}
export class AnnouncementCreateDto extends createZodDto(announcementCreateSchema) {}
export class AnnouncementUpdateDto extends createZodDto(announcementUpdateSchema) {}
