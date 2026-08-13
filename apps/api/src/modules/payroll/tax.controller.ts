import {
  financialYearSchema,
  taxDeclarationDecisionSchema,
  taxDeclarationSchema,
  taxRegimeSelectionSchema,
  tdsOverrideSchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TaxService } from './tax.service';
import { financialYearOf } from './tds-period';

export class TaxRegimeSelectionDto extends createZodDto(taxRegimeSelectionSchema) {}
export class TaxDeclarationDto extends createZodDto(taxDeclarationSchema) {}
export class TaxDeclarationDecisionDto extends createZodDto(taxDeclarationDecisionSchema) {}
export class TdsOverrideDto extends createZodDto(tdsOverrideSchema) {}

/**
 * Income tax (docs/03-api-structure.md §income-tax).
 *
 * A third payroll controller rather than more routes on `PayrollController`,
 * which is already past 380 lines — the same call `TdsController` made.
 *
 * The `/me` routes carry `payroll.read.own`, which everybody holds: your own
 * tax position is not a privilege HR grants. Everything about somebody else
 * needs `payroll.tax.view`, and **there is no `.team` scope** — what somebody
 * declared under 80D or 80U is medical information, and a reporting line is not
 * a reason to read it (docs/04-rbac.md §income-tax).
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/tax')
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  /** The financial year to answer for, defaulting to the one `month` sits in. */
  private year(value: string | undefined, month: string): string {
    if (!value) return financialYearOf(month);
    const parsed = financialYearSchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException('Choose a financial year, in the form 2026-27');
    }
    return parsed.data;
  }

  /**
   * Which payroll month to answer as of.
   *
   * A parameter rather than "now", because the remaining-months divisor must be
   * reproducible: asking about April in December has to still say twelve.
   */
  private month(value: string | undefined): string {
    if (!value) return new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new BadRequestException('Choose a payroll month, in the form 2026-08');
    }
    return value;
  }

  // ── Mine ────────────────────────────────────────────────────────────

  @Get('me')
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: 'My regime, projection and this month’s TDS' })
  async me(
    @CurrentUser() user: AccessTokenClaims,
    @Query('financialYear') fy?: string,
    @Query('month') monthParam?: string,
  ) {
    const month = this.month(monthParam);
    if (!user.employeeId)
      throw new BadRequestException('No employee record is linked to this account');
    return this.tax.summaryFor(user.orgId, user.employeeId, this.year(fy, month), month);
  }

  @Put('me/regime')
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: 'Choose my regime for a financial year' })
  setRegime(@CurrentUser() user: AccessTokenClaims, @Body() dto: TaxRegimeSelectionDto) {
    return this.tax.setRegime(user, dto.financialYear, dto.regime);
  }

  @Get('me/declaration')
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: 'My Old-regime declaration' })
  async myDeclaration(
    @CurrentUser() user: AccessTokenClaims,
    @Query('financialYear') fy?: string,
    @Query('month') monthParam?: string,
  ) {
    if (!user.employeeId)
      throw new BadRequestException('No employee record is linked to this account');
    return this.tax.declarationFor(
      user.orgId,
      user.employeeId,
      this.year(fy, this.month(monthParam)),
    );
  }

  @Put('me/declaration')
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: 'Save my declaration, replacing what was there' })
  saveDeclaration(@CurrentUser() user: AccessTokenClaims, @Body() dto: TaxDeclarationDto) {
    return this.tax.saveDeclaration(user, dto);
  }

  @Post('me/declaration/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: 'Send my declaration to HR' })
  submitDeclaration(
    @CurrentUser() user: AccessTokenClaims,
    @Body() body: { financialYear?: string },
  ) {
    return this.tax.submitDeclaration(user, this.year(body?.financialYear, this.month(undefined)));
  }

  // ── Everybody ───────────────────────────────────────────────────────

  /* Declared before ':employeeId' so it is not read as an employee id. */
  @Get('configuration')
  @RequirePermissions('payroll.tax.view')
  @ApiOperation({ summary: 'The configured tax rules, by year and regime' })
  configuration(@CurrentUser() user: AccessTokenClaims, @Query('financialYear') fy?: string) {
    return this.tax.configurations(user.orgId, fy);
  }

  @Get('pending')
  @RequirePermissions('payroll.tax.declaration.approve')
  @ApiOperation({ summary: 'Declarations waiting on HR' })
  pending(
    @CurrentUser() user: AccessTokenClaims,
    @Query('financialYear') fy?: string,
    @Query('month') monthParam?: string,
  ) {
    return this.tax.pendingDeclarations(user.orgId, this.year(fy, this.month(monthParam)));
  }

  @Get('employees')
  @RequirePermissions('payroll.tax.view')
  @ApiOperation({ summary: 'Everybody’s tax position for a year' })
  employees(
    @CurrentUser() user: AccessTokenClaims,
    @Query('financialYear') fy?: string,
    @Query('month') monthParam?: string,
    @Query('regime') regime?: 'NEW' | 'OLD',
    @Query('status') status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED',
    @Query('departmentId') departmentId?: string,
    @Query('search') search?: string,
  ) {
    const month = this.month(monthParam);
    return this.tax.listEmployees(user.orgId, this.year(fy, month), month, {
      regime,
      status,
      departmentId,
      search,
    });
  }

  @Get('employees/:employeeId')
  @RequirePermissions('payroll.tax.view')
  @ApiOperation({ summary: 'One person’s projection, slab by slab' })
  employee(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @Query('financialYear') fy?: string,
    @Query('month') monthParam?: string,
  ) {
    const month = this.month(monthParam);
    return this.tax.summaryFor(user.orgId, employeeId, this.year(fy, month), month);
  }

  @Get('employees/:employeeId/declaration')
  @RequirePermissions('payroll.tax.view')
  @ApiOperation({ summary: 'One person’s declaration' })
  employeeDeclaration(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @Query('financialYear') fy?: string,
    @Query('month') monthParam?: string,
  ) {
    return this.tax.declarationFor(user.orgId, employeeId, this.year(fy, this.month(monthParam)));
  }

  @Post('employees/:employeeId/declaration/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll.tax.declaration.approve')
  @ApiOperation({ summary: 'Approve a declaration' })
  approve(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @Body() dto: TaxDeclarationDecisionDto,
    @Query('financialYear') fy?: string,
    @Query('month') monthParam?: string,
  ) {
    const year = this.year(fy, this.month(monthParam));
    return this.tax.decideDeclaration(user, employeeId, year, 'APPROVED', dto);
  }

  @Post('employees/:employeeId/declaration/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payroll.tax.declaration.approve')
  @ApiOperation({ summary: 'Send a declaration back, with a reason' })
  reject(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @Body() dto: TaxDeclarationDecisionDto,
    @Query('financialYear') fy?: string,
    @Query('month') monthParam?: string,
  ) {
    const year = this.year(fy, this.month(monthParam));
    return this.tax.decideDeclaration(user, employeeId, year, 'REJECTED', dto);
  }

  @Put('employees/:employeeId/override')
  @RequirePermissions('payroll.tax.manage')
  @ApiOperation({ summary: 'Override one month’s calculated TDS, with a reason' })
  override(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @Body() dto: TdsOverrideDto,
  ) {
    return this.tax.overrideTds(user, employeeId, dto);
  }

  @Delete('employees/:employeeId/override')
  @RequirePermissions('payroll.tax.manage')
  @ApiOperation({ summary: 'Drop an override and go back to the calculated figure' })
  clearOverride(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
  ) {
    return this.tax.clearOverride(user, employeeId, this.month(month));
  }
}
