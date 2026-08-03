import {
  approvalDecisionSchema,
  attendanceDayQuerySchema,
  attendanceRequestCreateSchema,
  attendanceRequestQuerySchema,
  attendanceSummaryQuerySchema,
  clockInSchema,
  clockOutSchema,
  myAttendanceQuerySchema,
} from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

// `.prefault({})` so a request with no body at all still parses — clocking in
// must never fail because a client did not know to send one.
export class ClockInDto extends createZodDto(clockInSchema.prefault({})) {}
export class ClockOutDto extends createZodDto(clockOutSchema.prefault({})) {}

export class MyAttendanceQueryDto extends createZodDto(myAttendanceQuerySchema) {}
export class AttendanceDayQueryDto extends createZodDto(attendanceDayQuerySchema) {}
export class AttendanceSummaryQueryDto extends createZodDto(attendanceSummaryQuerySchema) {}
export class AttendanceRequestCreateDto extends createZodDto(attendanceRequestCreateSchema) {}
export class AttendanceRequestQueryDto extends createZodDto(attendanceRequestQuerySchema) {}
export class ApprovalDecisionDto extends createZodDto(approvalDecisionSchema) {}
