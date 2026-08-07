import type { PayrollReportKind } from '@hrms/shared';
import { PAYROLL_REPORTS } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { serializeReport } from '../reports/report-export';
import {
  EmployeeSalaryDto,
  PaymentUpdateDto,
  PayrollAdjustmentDto,
  PayrollAdjustmentQueryDto,
  PayrollReportQueryDto,
  PayrollRunActionDto,
  PayrollRunCreateDto,
  PayrollRunQueryDto,
  PayslipQueryDto,
  SalaryQueryDto,
  SalaryStructureCreateDto,
  SalaryStructureQueryDto,
  SalaryStructureUpdateDto,
} from './dto/payroll.dto';
import { EmployeeSalariesService } from './employee-salaries.service';
import { PayrollAdjustmentsService } from './payroll-adjustments.service';
import { PayrollReportsService } from './payroll-reports.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayslipsService } from './payslips.service';
import { SalaryStructuresService } from './salary-structures.service';

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly structures: SalaryStructuresService,
    private readonly salaries: EmployeeSalariesService,
    private readonly runs: PayrollRunsService,
    private readonly payslips: PayslipsService,
    private readonly reports: PayrollReportsService,
    private readonly adjustmentsService: PayrollAdjustmentsService,
    private readonly prisma: PrismaService,
  ) {}

  // ── pay components & structures ───────────────────────────────────────

  @Get('components')
  @RequirePermissions('payroll.structure.manage', 'payroll.read')
  @ApiOperation({ summary: 'Pay component catalogue' })
  components(@CurrentUser() user: AccessTokenClaims) {
    return this.structures.components(user.orgId);
  }

  @Get('structures')
  @RequirePermissions('payroll.read', 'payroll.structure.manage')
  @ApiOperation({ summary: 'List salary structures' })
  listStructures(@CurrentUser() user: AccessTokenClaims, @Query() query: SalaryStructureQueryDto) {
    return this.structures.list(user.orgId, query);
  }

  @Get('structures/options')
  @RequirePermissions('payroll.salary.manage', 'payroll.read')
  @ApiOperation({ summary: 'Active structures for the assignment form' })
  structureOptions(@CurrentUser() user: AccessTokenClaims) {
    return this.structures.options(user.orgId);
  }

  @Get('structures/:id')
  @RequirePermissions('payroll.read', 'payroll.structure.manage')
  @ApiOperation({ summary: 'One salary structure with its components' })
  getStructure(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.structures.get(user.orgId, id);
  }

  @Post('structures')
  @RequirePermissions('payroll.structure.manage')
  @ApiOperation({ summary: 'Create a salary structure' })
  createStructure(@CurrentUser() user: AccessTokenClaims, @Body() dto: SalaryStructureCreateDto) {
    return this.structures.create(ctx(user), dto);
  }

  @Patch('structures/:id')
  @RequirePermissions('payroll.structure.manage')
  @ApiOperation({ summary: 'Update a salary structure' })
  updateStructure(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: SalaryStructureUpdateDto,
  ) {
    return this.structures.update(ctx(user), id, dto);
  }

  @Post('structures/:id/clone')
  @RequirePermissions('payroll.structure.manage')
  @ApiOperation({ summary: 'Clone a salary structure' })
  cloneStructure(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.structures.clone(ctx(user), id);
  }

  @Delete('structures/:id')
  @RequirePermissions('payroll.structure.manage')
  @ApiOperation({ summary: 'Delete an unused salary structure' })
  deleteStructure(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.structures.remove(ctx(user), id);
  }

  // ── employee salary ───────────────────────────────────────────────────

  @Get('salaries')
  @RequirePermissions('payroll.read', 'payroll.salary.manage')
  @ApiOperation({ summary: 'Roster with current salary' })
  listSalaries(@CurrentUser() user: AccessTokenClaims, @Query() query: SalaryQueryDto) {
    return this.salaries.list(user, query);
  }

  @Get('salaries/me')
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: "The signed-in employee's own salary and history" })
  mySalary(@CurrentUser() user: AccessTokenClaims) {
    if (!user.employeeId)
      throw new BadRequestException('No employee record is linked to this account');
    return this.salaries.timeline(user, user.employeeId);
  }

  @Get('salaries/:employeeId')
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: 'Salary revision timeline for one employee' })
  salaryTimeline(@CurrentUser() user: AccessTokenClaims, @Param('employeeId') employeeId: string) {
    return this.salaries.timeline(user, employeeId);
  }

  @Post('salaries')
  @RequirePermissions('payroll.salary.manage')
  @ApiOperation({ summary: 'Assign or revise a salary' })
  assignSalary(@CurrentUser() user: AccessTokenClaims, @Body() dto: EmployeeSalaryDto) {
    return this.salaries.assign(ctx(user), dto);
  }

  @Delete('salaries/:id')
  @RequirePermissions('payroll.salary.manage')
  @ApiOperation({ summary: 'Remove a salary revision that has not been paid against' })
  deleteSalary(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.salaries.remove(ctx(user), id);
  }

  // ── adjustments ───────────────────────────────────────────────────────
  // One-offs for a single month. Gated on payroll.process rather than
  // salary.manage: this changes what one run pays, not what somebody earns.

  @Get('adjustments')
  @RequirePermissions('payroll.read', 'payroll.process')
  @ApiOperation({ summary: 'One-off adjustments entered for a month' })
  adjustments(@CurrentUser() user: AccessTokenClaims, @Query() query: PayrollAdjustmentQueryDto) {
    return this.adjustmentsService.list(user.orgId, query);
  }

  @Post('adjustments')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Set a bonus, incentive or recovery for one employee and month' })
  setAdjustment(@CurrentUser() user: AccessTokenClaims, @Body() dto: PayrollAdjustmentDto) {
    return this.adjustmentsService.upsert(ctx(user), dto);
  }

  @Delete('adjustments/:id')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Remove an adjustment before the month is settled' })
  deleteAdjustment(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.adjustmentsService.remove(ctx(user), id);
  }

  // ── runs ──────────────────────────────────────────────────────────────

  @Get('runs')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'List payroll runs' })
  listRuns(@CurrentUser() user: AccessTokenClaims, @Query() query: PayrollRunQueryDto) {
    return this.runs.list(user.orgId, query);
  }

  @Get('runs/:id')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'One payroll run' })
  getRun(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.runs.get(user.orgId, id);
  }

  @Get('runs/:id/preflight')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'What would stop this run producing correct payslips' })
  preflight(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.runs.preflight(user.orgId, id);
  }

  @Post('runs')
  @RequirePermissions('payroll.process')
  @ApiOperation({ summary: 'Open payroll for a month' })
  createRun(@CurrentUser() user: AccessTokenClaims, @Body() dto: PayrollRunCreateDto) {
    return this.runs.create(ctx(user), dto);
  }

  /*
   * One endpoint for every transition rather than five verbs. The state
   * machine already decides what is legal and which permission it needs, so
   * splitting it would duplicate that decision in the routing table.
   */
  @Post('runs/:id/actions')
  @RequirePermissions('payroll.process', 'payroll.approve')
  @ApiOperation({ summary: 'Calculate, approve, reopen, lock, publish or cancel' })
  actOnRun(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: PayrollRunActionDto,
  ) {
    return this.runs.act(user, id, dto);
  }

  // ── payslips ──────────────────────────────────────────────────────────

  @Get('payslips')
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: 'Payslips visible to the caller' })
  listPayslips(@CurrentUser() user: AccessTokenClaims, @Query() query: PayslipQueryDto) {
    return this.payslips.list(user, query);
  }

  @Get('payslips/me')
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: "The signed-in employee's own published payslips" })
  myPayslips(@CurrentUser() user: AccessTokenClaims, @Query() query: PayslipQueryDto) {
    return this.payslips.mine(user, query);
  }

  @Get('payslips/:id')
  @RequirePermissions('payroll.read.own')
  @ApiOperation({ summary: 'One payslip with its full breakdown' })
  getPayslip(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.payslips.get(user, id);
  }

  @Patch('payslips/payment')
  @RequirePermissions('payroll.pay')
  @ApiOperation({ summary: 'Record payment against one or more payslips' })
  updatePayment(@CurrentUser() user: AccessTokenClaims, @Body() dto: PaymentUpdateDto) {
    return this.payslips.updatePayment(user, dto);
  }

  // ── reports ───────────────────────────────────────────────────────────

  @Get('reports/:kind')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'Payroll report as JSON, CSV or Excel' })
  async report(
    @CurrentUser() user: AccessTokenClaims,
    @Param('kind') kind: string,
    @Query() query: PayrollReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!PAYROLL_REPORTS.includes(kind as PayrollReportKind)) {
      throw new BadRequestException(`Unknown report: ${kind}`);
    }
    // Checked before the report is built: a rejected export should not first
    // cost the aggregation.
    if (query.format !== 'json' && !new Set(user.perms).has('report.export')) {
      throw new ForbiddenException('You do not have permission to export reports');
    }

    const result = await this.reports.build(user.orgId, kind as PayrollReportKind, query);
    if (query.format === 'json') return result;

    const { body, contentType, extension } = serializeReport(
      query.format,
      result.columns,
      result.rows,
      result.title,
    );
    await auditMutation(
      this.prisma,
      ctx(user),
      'payroll.report.export',
      'PayrollReport',
      `${kind}:${query.month}`,
      {
        after: { format: query.format, rows: result.rows.length },
      },
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="hrms-payroll-${kind}-${query.month}.${extension}"`,
    );
    return body;
  }
}

function ctx(user: AccessTokenClaims) {
  return { orgId: user.orgId, userId: user.sub };
}
