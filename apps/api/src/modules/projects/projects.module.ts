import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TimesheetsController } from './timesheets.controller';
import { TimesheetsService } from './timesheets.service';

/**
 * Projects and the weeks logged against them.
 *
 * The empty `imports` array is the point, and the third module to manage it
 * after Performance and Helpdesk: `NotificationsModule` is `@Global`, and
 * everything else this needs is `PrismaService`. A module that reaches into
 * another module's internals is a module whose design wanted an ADR first
 * (docs/11-roadmap.md §rule-for-every-future-module).
 *
 * Two controllers rather than one because a timesheet spans projects and does
 * not belong under `/projects/:id`. They share a folder, a mapper and a rules
 * file, which is where the module actually is.
 */
@Module({
  imports: [],
  controllers: [ProjectsController, TimesheetsController],
  providers: [ProjectsService, TimesheetsService],
})
export class ProjectsModule {}
