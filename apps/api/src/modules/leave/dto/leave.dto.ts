import {
  leaveApplySchema,
  leaveBalanceAdjustSchema,
  leaveBalanceQuerySchema,
  leaveCalendarQuerySchema,
  leaveDecisionSchema,
  leavePreviewQuerySchema,
  leaveRequestQuerySchema,
  leaveTypeCreateSchema,
  leaveTypeUpdateSchema,
  paginationQuerySchema,
} from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

export class LeaveListQueryDto extends createZodDto(paginationQuerySchema) {}
export class LeaveTypeCreateDto extends createZodDto(leaveTypeCreateSchema) {}
export class LeaveTypeUpdateDto extends createZodDto(leaveTypeUpdateSchema) {}
export class LeaveApplyDto extends createZodDto(leaveApplySchema) {}
export class LeavePreviewQueryDto extends createZodDto(leavePreviewQuerySchema) {}
export class LeaveRequestQueryDto extends createZodDto(leaveRequestQuerySchema) {}
export class LeaveDecisionDto extends createZodDto(leaveDecisionSchema) {}
export class LeaveBalanceQueryDto extends createZodDto(leaveBalanceQuerySchema) {}
export class LeaveBalanceAdjustDto extends createZodDto(leaveBalanceAdjustSchema) {}
export class LeaveCalendarQueryDto extends createZodDto(leaveCalendarQuerySchema) {}
