import { reportRangeSchema } from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class ReportRangeQueryDto extends createZodDto(reportRangeSchema) {}
