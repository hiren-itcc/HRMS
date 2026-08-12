import { payComponentCreateSchema, payComponentUpdateSchema } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PayComponentsService } from './pay-components.service';

export class PayComponentCreateDto extends createZodDto(payComponentCreateSchema) {}
export class PayComponentUpdateDto extends createZodDto(payComponentUpdateSchema) {}

/**
 * The pay component catalogue: create, rename, retire.
 *
 * A second controller on the `payroll` prefix, the same reasoning
 * `TdsController` gives — `PayrollController` is already long and paths do
 * not collide. `GET components` moved here unchanged from `PayrollController`
 * (same path, same default behaviour); create, update and delete are new —
 * see `pay-components.guardrails.ts` for why they cannot be plain CRUD.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayComponentsController {
  constructor(private readonly components: PayComponentsService) {}

  @Get('components')
  @RequirePermissions('payroll.structure.manage', 'payroll.read')
  @ApiOperation({ summary: 'Pay component catalogue' })
  list(@CurrentUser() user: AccessTokenClaims, @Query('includeInactive') includeInactive?: string) {
    /*
     * `includeInactive` is only honoured for a caller who holds the manage
     * permission — a `payroll.read` caller sending it must still see exactly
     * the active-only list every existing caller already gets, unchanged.
     */
    const canSeeInactive = new Set(user.perms).has('payroll.structure.manage');
    return this.components.list(user.orgId, canSeeInactive && includeInactive === 'true');
  }

  @Post('components')
  @RequirePermissions('payroll.structure.manage')
  @ApiOperation({ summary: 'Add a pay component' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: PayComponentCreateDto) {
    return this.components.create(ctx(user), dto);
  }

  @Patch('components/:id')
  @RequirePermissions('payroll.structure.manage')
  @ApiOperation({ summary: 'Rename or retune a component — code cannot change' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: PayComponentUpdateDto,
  ) {
    return this.components.update(ctx(user), id, dto);
  }

  @Delete('components/:id')
  @RequirePermissions('payroll.structure.manage')
  @ApiOperation({ summary: 'Delete a component nothing references' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.components.remove(ctx(user), id);
  }
}

function ctx(user: AccessTokenClaims) {
  return { orgId: user.orgId, userId: user.sub };
}
