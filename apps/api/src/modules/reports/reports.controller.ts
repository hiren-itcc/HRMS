import type { ReportRangeQuery, ReportResult } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Controller, ForbiddenException, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { ReportRangeQueryDto } from './dto/report.dto';
import { serializeReport } from './report-export';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
// A 366-day org-wide report is the most expensive request in the system;
// it should not be trivially loopable at the global 100/min.
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('employees')
  @RequirePermissions('report.view', 'report.view.team')
  @ApiOperation({ summary: 'Headcount, joiners/leavers, attrition and tenure' })
  employees(
    @CurrentUser() user: AccessTokenClaims,
    @Query() query: ReportRangeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deliver(user, query, res, 'employees', () => this.reports.employees(user, query));
  }

  @Get('attendance')
  @RequirePermissions('report.view', 'report.view.team')
  @ApiOperation({ summary: 'Per-employee attendance aggregates over a date range' })
  attendance(
    @CurrentUser() user: AccessTokenClaims,
    @Query() query: ReportRangeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deliver(user, query, res, 'attendance', () => this.reports.attendance(user, query));
  }

  @Get('leave')
  @RequirePermissions('report.view', 'report.view.team')
  @ApiOperation({ summary: 'Leave taken vs entitlement, by type and department' })
  leave(
    @CurrentUser() user: AccessTokenClaims,
    @Query() query: ReportRangeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deliver(user, query, res, 'leave', () => this.reports.leave(user, query));
  }

  @Get('departments')
  @RequirePermissions('report.view', 'report.view.team')
  @ApiOperation({ summary: 'Per-department headcount, attendance and leave rollup' })
  departments(
    @CurrentUser() user: AccessTokenClaims,
    @Query() query: ReportRangeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deliver(user, query, res, 'departments', () =>
      this.reports.departments(user, query),
    );
  }

  @Get('summary')
  @RequirePermissions('report.view', 'report.view.team')
  @ApiOperation({ summary: 'Six-month headcount trend for the dashboard widget' })
  summary(@CurrentUser() user: AccessTokenClaims) {
    return this.reports.summary(user);
  }

  /**
   * One place decides JSON vs file. Viewing and extracting are different
   * privileges — a manager may read their team's numbers on screen without
   * being able to walk out with the dataset — so `report.export` is checked
   * here rather than on the route, and every export leaves an audit trail.
   */
  private async deliver(
    user: AccessTokenClaims,
    query: ReportRangeQuery,
    res: Response,
    name: string,
    build: () => Promise<ReportResult>,
  ): Promise<ReportResult | string> {
    // Checked before the report is built: a rejected export should not first
    // cost a full 366-day aggregation.
    if (query.format !== 'json' && !new Set(user.perms).has('report.export')) {
      throw new ForbiddenException('You do not have permission to export reports');
    }

    const result = await build();
    if (query.format === 'json') return result;

    const { body, contentType, extension } = serializeReport(
      query.format,
      result.columns,
      result.rows,
      result.meta.title,
    );
    const filename = `hrms-${name}-${query.from}_${query.to}.${extension}`;

    await auditMutation(
      this.prisma,
      { orgId: user.orgId, userId: user.sub },
      'report.export',
      'Report',
      `${name}:${query.format}:${query.from}..${query.to}`,
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return body;
  }
}
