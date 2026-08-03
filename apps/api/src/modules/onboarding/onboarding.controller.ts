import {
  bankDetailSchema,
  employeeOnboardSchema,
  onboardingDocumentSchema,
  onboardingProfileSchema,
  onboardingQuerySchema,
  onboardingRequestChangesSchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { AllowDuringOnboarding } from '../../common/decorators/allow-during-onboarding.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EmployeesService } from '../employees/employees.service';
import { OnboardingService } from './onboarding.service';

class EmployeeOnboardDto extends createZodDto(employeeOnboardSchema) {}
class OnboardingProfileDto extends createZodDto(onboardingProfileSchema) {}
class OnboardingDocumentDto extends createZodDto(onboardingDocumentSchema) {}
class OnboardingRequestChangesDto extends createZodDto(onboardingRequestChangesSchema) {}
class OnboardingQueryDto extends createZodDto(onboardingQuerySchema) {}
class BankDetailDto extends createZodDto(bankDetailSchema) {}

/**
 * The new hire's own wizard.
 *
 * No `@RequirePermissions` anywhere: the subject is taken from the JWT, the
 * same convention `MeController` uses. Every route carries
 * `@AllowDuringOnboarding()` — they are the exception the guard exists to
 * make — and the service additionally refuses writes once the record leaves
 * IN_PROGRESS, which is the check the token claim cannot make.
 */
@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('me/onboarding')
export class MyOnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly employees: EmployeesService,
  ) {}

  @Get()
  @AllowDuringOnboarding()
  @ApiOperation({ summary: 'My onboarding record and what is still outstanding' })
  mine(@CurrentUser() user: AccessTokenClaims) {
    return this.onboarding.mine(user);
  }

  @Patch('profile')
  @AllowDuringOnboarding()
  @ApiOperation({ summary: 'Fill in my own personal details (only while in progress)' })
  updateProfile(@CurrentUser() user: AccessTokenClaims, @Body() dto: OnboardingProfileDto) {
    return this.onboarding.updateMine(user, dto);
  }

  /**
   * Routed through EmployeesService so `employee.bank.update` stays one audit
   * action however the details arrived.
   */
  @Put('bank')
  @AllowDuringOnboarding()
  @ApiOperation({ summary: 'Set my own bank details (only while in progress)' })
  async setBank(@CurrentUser() user: AccessTokenClaims, @Body() dto: BankDetailDto) {
    await this.onboarding.assertOwnAndEditable(user);
    return this.employees.upsertBank(user, user.employeeId as string, dto);
  }

  @Post('documents')
  @AllowDuringOnboarding()
  @ApiOperation({ summary: 'File an uploaded document against a checklist item' })
  attach(@CurrentUser() user: AccessTokenClaims, @Body() dto: OnboardingDocumentDto) {
    return this.onboarding.attachDocument(user, dto);
  }

  @Post('submit')
  @AllowDuringOnboarding()
  @ApiOperation({ summary: 'Hand my onboarding to HR for review' })
  submit(@CurrentUser() user: AccessTokenClaims) {
    return this.onboarding.submit(user);
  }
}

/** HR's side: invite, chase, review. */
@ApiTags('onboarding')
@ApiBearerAuth()
@Controller()
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('employees/onboard')
  @RequirePermissions('employee.create')
  @ApiOperation({ summary: 'Invite a new hire — creates the record and emails them' })
  onboard(@CurrentUser() user: AccessTokenClaims, @Body() dto: EmployeeOnboardDto) {
    return this.onboarding.onboard(user, dto);
  }

  @Get('employees/:id/invite')
  @RequirePermissions('employee.read')
  @ApiOperation({ summary: 'Invitation state — where it went, whether it is still live' })
  inviteStatus(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.onboarding.inviteStatus(user, id);
  }

  @Post('employees/:id/invite')
  @RequirePermissions('employee.invite')
  @ApiOperation({ summary: 'Resend the invitation — the previous link stops working' })
  resend(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.onboarding.resendInvite(user, id);
  }

  @Get('onboarding')
  @RequirePermissions('employee.read')
  @ApiOperation({ summary: 'Onboarding records, newest first' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: OnboardingQueryDto) {
    return this.onboarding.list(user, query);
  }

  @Get('onboarding/:id')
  @RequirePermissions('employee.read')
  @ApiOperation({ summary: 'One submission, with the details and bank account to check' })
  detail(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.onboarding.detail(user, id);
  }

  @Post('onboarding/:id/approve')
  @RequirePermissions('employee.onboarding.approve')
  @ApiOperation({ summary: 'Accept the submission — the employee becomes active' })
  approve(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.onboarding.approve(user, id);
  }

  @Post('onboarding/:id/request-changes')
  @RequirePermissions('employee.onboarding.approve')
  @ApiOperation({ summary: 'Send it back with a note' })
  requestChanges(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: OnboardingRequestChangesDto,
  ) {
    return this.onboarding.requestChanges(user, id, dto.note);
  }
}
