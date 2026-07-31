import {
  approvalDecisionSchema,
  attendanceDayQuerySchema,
  attendanceRequestCreateSchema,
  attendanceRequestQuerySchema,
  attendanceSummaryQuerySchema,
  myAttendanceQuerySchema,
} from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class MyAttendanceQueryDto extends createZodDto(myAttendanceQuerySchema) {}
export class AttendanceDayQueryDto extends createZodDto(attendanceDayQuerySchema) {}
export class AttendanceSummaryQueryDto extends createZodDto(attendanceSummaryQuerySchema) {}
export class AttendanceRequestCreateDto extends createZodDto(attendanceRequestCreateSchema) {}
export class AttendanceRequestQueryDto extends createZodDto(attendanceRequestQuerySchema) {}
export class ApprovalDecisionDto extends createZodDto(approvalDecisionSchema) {}
