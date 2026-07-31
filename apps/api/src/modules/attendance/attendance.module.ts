import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRequestsService } from './attendance-requests.service';

/** Attendance (docs/03-api-structure.md §attendance). */
@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceRequestsService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
