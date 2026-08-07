import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OnboardingGuard } from './common/guards/onboarding.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { validateEnv } from './config/env';
import { PrismaModule } from './database/prisma.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { HealthController } from './modules/health/health.controller';
import { LeaveModule } from './modules/leave/leave.module';
import { LettersModule } from './modules/letters/letters.module';
import { LifecycleJobsModule } from './modules/lifecycle/lifecycle-jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OffboardingModule } from './modules/offboarding/offboarding.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RecruitmentModule } from './modules/recruitment/recruitment.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ResignationsModule } from './modules/resignations/resignations.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { StorageModule } from './modules/storage/storage.module';
import { WfhModule } from './modules/wfh/wfh.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    NotificationsModule,
    AuthModule,
    OrganizationModule,
    EmployeesModule,
    DocumentsModule,
    LettersModule,
    OnboardingModule,
    ResignationsModule,
    OffboardingModule,
    AssetsModule,
    ExpensesModule,
    LifecycleJobsModule,
    DashboardModule,
    AttendanceModule,
    WfhModule,
    LeaveModule,
    AnnouncementsModule,
    RecruitmentModule,
    ReportsModule,
    PayrollModule,
    SettlementsModule,
    SettingsModule,
    StorageModule,
    AuditModule,
    RbacModule,
  ],
  controllers: [HealthController],
  providers: [
    // Request pipeline (docs/08-nestjs-architecture.md §cross-cutting):
    // throttle → identity → default-password → onboarding → permissions → zod → error shaping
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Must sit after identity (it reads req.user) and before permissions, so a
    // holder of the shared default password is stopped regardless of what
    // their role would otherwise allow.
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    // Same reasoning one step further: an employee still onboarding holds the
    // EMPLOYEE role, which is far wider than the wizard they should be in.
    { provide: APP_GUARD, useClass: OnboardingGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
