import {
  expenseCategoryCreateSchema,
  expenseCategoryUpdateSchema,
  expenseClaimCreateSchema,
  expenseClaimQuerySchema,
  expenseClaimUpdateSchema,
  expenseDecisionSchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpensesService } from './expenses.service';

export class ExpenseClaimCreateDto extends createZodDto(expenseClaimCreateSchema) {}
export class ExpenseClaimUpdateDto extends createZodDto(expenseClaimUpdateSchema) {}
export class ExpenseClaimQueryDto extends createZodDto(expenseClaimQuerySchema) {}
export class ExpenseDecisionDto extends createZodDto(expenseDecisionSchema) {}
export class ExpenseCategoryCreateDto extends createZodDto(expenseCategoryCreateSchema) {}
export class ExpenseCategoryUpdateDto extends createZodDto(expenseCategoryUpdateSchema) {}

/**
 * Expense claims (docs/03-api-structure.md §expenses).
 *
 * The read routes carry the weakest code that could reach them —
 * `expense.read.own` — and the service narrows from there using the token's
 * scope, because the guard cannot know *whose* claim an id belongs to. The
 * decide routes are the same shape: `expense.approve.team` gets you to the
 * handler, and the service checks you actually manage that person.
 */
@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly categories: ExpenseCategoriesService,
  ) {}

  /* Declared before ':id' so it is not read as a claim id. */
  @Get('categories')
  @RequirePermissions('expense.read.own')
  @ApiOperation({ summary: 'What can be claimed for' })
  listCategories(@CurrentUser() user: AccessTokenClaims) {
    return this.categories.list(user.orgId);
  }

  @Get('categories/all')
  @RequirePermissions('expense.manage')
  @ApiOperation({ summary: 'Categories including deactivated ones' })
  listAllCategories(@CurrentUser() user: AccessTokenClaims) {
    return this.categories.list(user.orgId, true);
  }

  @Post('categories')
  @RequirePermissions('expense.manage')
  @ApiOperation({ summary: 'Add a category and the payslip line it pays out on' })
  createCategory(@CurrentUser() user: AccessTokenClaims, @Body() dto: ExpenseCategoryCreateDto) {
    return this.categories.create(user, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions('expense.manage')
  @ApiOperation({ summary: 'Edit a category' })
  updateCategory(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ExpenseCategoryUpdateDto,
  ) {
    return this.categories.update(user, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions('expense.manage')
  @ApiOperation({ summary: 'Delete a category nothing has been claimed against' })
  removeCategory(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.categories.remove(user, id);
  }

  @Get()
  @RequirePermissions('expense.read.own')
  @ApiOperation({ summary: 'Claims — own, team or all, per the scope and your permissions' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: ExpenseClaimQueryDto) {
    return this.expenses.list(user, query);
  }

  @Post()
  @RequirePermissions('expense.submit.own')
  @ApiOperation({ summary: 'Start a claim' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: ExpenseClaimCreateDto) {
    return this.expenses.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('expense.read.own')
  @ApiOperation({ summary: 'One claim with its lines' })
  get(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.expenses.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions('expense.submit.own')
  @ApiOperation({ summary: 'Edit a draft — lines are replaced wholesale' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ExpenseClaimUpdateDto,
  ) {
    return this.expenses.update(user, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('expense.submit.own')
  @ApiOperation({ summary: 'Send a draft for approval' })
  submit(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.expenses.submit(user, id);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('expense.submit.own')
  @ApiOperation({ summary: 'Pull a claim back before it is decided' })
  withdraw(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.expenses.withdraw(user, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('expense.approve.team')
  @ApiOperation({ summary: 'Approve, and put it on the chosen month’s payslip' })
  approve(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ExpenseDecisionDto,
  ) {
    return this.expenses.decide(user, id, 'APPROVED', dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('expense.approve.team')
  @ApiOperation({ summary: 'Decline it' })
  reject(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ExpenseDecisionDto,
  ) {
    return this.expenses.decide(user, id, 'REJECTED', dto);
  }
}
