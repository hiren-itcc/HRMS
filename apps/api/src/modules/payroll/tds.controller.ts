import { type TdsChallanCreateInput, tdsChallanCreateSchema } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { TdsChallansService } from './tds-challans.service';
import { isFinancialYear, type TdsQuarterCode } from './tds-period';
import { TdsReturnsService } from './tds-returns.service';

const QUARTERS: TdsQuarterCode[] = ['Q1', 'Q2', 'Q3', 'Q4'];

/**
 * TDS challans and Form 24Q.
 *
 * A second controller on the `payroll` prefix rather than ten more routes on
 * `PayrollController`, which is already 384 lines. Paths do not collide.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class TdsController {
  constructor(
    private readonly challans: TdsChallansService,
    private readonly returns: TdsReturnsService,
  ) {}

  private quarter(value: string): TdsQuarterCode {
    if (!QUARTERS.includes(value as TdsQuarterCode)) {
      throw new BadRequestException('Choose a quarter: Q1, Q2, Q3 or Q4');
    }
    return value as TdsQuarterCode;
  }

  private year(value: string): string {
    if (!isFinancialYear(value)) {
      throw new BadRequestException('Choose a financial year, in the form 2026-27');
    }
    return value;
  }

  // ── the challan register ──────────────────────────────────────────────

  @Get('challans')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'TDS challans deposited' })
  listChallans(@CurrentUser() user: AccessTokenClaims, @Query('fy') fy?: string) {
    return this.challans.list(user, fy ? this.year(fy) : undefined);
  }

  @Post('challans')
  @RequirePermissions('payroll.filing')
  @ApiOperation({ summary: 'Record a deposit' })
  createChallan(@CurrentUser() user: AccessTokenClaims, @Body() body: TdsChallanCreateInput) {
    return this.challans.create(user, tdsChallanCreateSchema.parse(body));
  }

  @Patch('challans/:id')
  @RequirePermissions('payroll.filing')
  @ApiOperation({ summary: 'Correct a recorded deposit' })
  updateChallan(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: TdsChallanCreateInput,
  ) {
    return this.challans.update(user, id, tdsChallanCreateSchema.parse(body));
  }

  @Delete('challans/:id')
  @RequirePermissions('payroll.filing')
  @ApiOperation({ summary: 'Remove a recorded deposit' })
  removeChallan(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.challans.remove(user, id);
  }

  // ── Form 24Q ──────────────────────────────────────────────────────────

  /*
   * `returns/readiness` and `returns/preview` are declared before
   * `returns/:id/file` so neither is ever read as an id — the same ordering
   * trap `filings` had to step around in PayrollController.
   */
  @Get('returns/readiness')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'Whether a quarter can be filed at all, before it is chosen' })
  readiness(
    @CurrentUser() user: AccessTokenClaims,
    @Query('fy') fy: string,
    @Query('quarter') quarter: string,
  ) {
    return this.returns.readiness(user, this.year(fy), this.quarter(quarter));
  }

  @Get('returns/preview')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'What the return would contain' })
  preview(
    @CurrentUser() user: AccessTokenClaims,
    @Query('fy') fy: string,
    @Query('quarter') quarter: string,
  ) {
    return this.returns.preview(user, this.year(fy), this.quarter(quarter));
  }

  @Get('returns')
  @RequirePermissions('payroll.read')
  @ApiOperation({ summary: 'Returns generated so far' })
  listReturns(@CurrentUser() user: AccessTokenClaims, @Query('fy') fy?: string) {
    return this.returns.list(user, fy ? this.year(fy) : undefined);
  }

  @Post('returns')
  @RequirePermissions('payroll.filing')
  @ApiOperation({ summary: 'Generate and freeze a 24Q' })
  generate(
    @CurrentUser() user: AccessTokenClaims,
    @Query('fy') fy: string,
    @Query('quarter') quarter: string,
  ) {
    return this.returns.generate(user, this.year(fy), this.quarter(quarter));
  }

  @Get('returns/:id/file')
  @RequirePermissions('payroll.filing')
  @ApiOperation({ summary: 'The frozen bytes, exactly as generated' })
  async returnFile(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { content, filename, contentType } = await this.returns.file(user, id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return content;
  }

  @Delete('returns/:id')
  @RequirePermissions('payroll.filing')
  @ApiOperation({ summary: 'Discard one, so the quarter can be generated again' })
  removeReturn(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.returns.remove(user, id);
  }
}
