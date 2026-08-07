import { Module } from '@nestjs/common';
import { WfhModule } from '../wfh/wfh.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRequestsService } from './attendance-requests.service';

/** Attendance (docs/03-api-structure.md §attendance). */
@Module({
  // One direction: attendance asks WFH which days were agreed. Nothing in WFH
  // reads attendance, so there is no cycle to guard.
  imports: [WfhModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceRequestsService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
