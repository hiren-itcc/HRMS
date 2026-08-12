import { roleCreateSchema, roleUpdateSchema } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RbacService } from './rbac.service';

class RolePermissionsDto extends createZodDto(
  z.object({ permissions: z.array(z.string()).max(200) }),
) {}

class RoleCreateDto extends createZodDto(roleCreateSchema) {}
class RoleUpdateDto extends createZodDto(roleUpdateSchema) {}

@ApiTags('rbac')
@ApiBearerAuth()
@Controller()
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('roles')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Roles in this organization with their grants' })
  roles(@CurrentUser() user: AccessTokenClaims) {
    return this.rbac.roles(user);
  }

  /**
   * Names for a role picker — code and name only, never the grants.
   *
   * `employee.create` is on the gate because the new-employee form picks a
   * `loginRole`, and whoever fills that in need not hold `role.manage`
   * (changing a role afterwards does, on `employees.controller.ts:114`). The
   * guard is an OR, so a `role.manage` holder still reaches it.
   *
   * Kept separate from `roles()` rather than widening that route: seeing who
   * may hold a role is a much smaller disclosure than the full permission
   * matrix, which is what `roles()` returns.
   */
  @Get('roles/assignable')
  @RequirePermissions('employee.create', 'role.manage')
  @ApiOperation({ summary: 'Roles a person can be assigned to (code and name only)' })
  assignable(@CurrentUser() user: AccessTokenClaims) {
    return this.rbac.assignableRoles(user.orgId);
  }

  @Post('roles')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Compose a custom role' })
  createRole(@CurrentUser() user: AccessTokenClaims, @Body() dto: RoleCreateDto) {
    return this.rbac.createRole(user, dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Rename a custom role (system roles are protected)' })
  updateRole(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: RoleUpdateDto,
  ) {
    return this.rbac.updateRole(user, id, dto);
  }

  @Delete('roles/:id')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Delete a custom role nobody holds' })
  deleteRole(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.rbac.deleteRole(user, id);
  }

  @Get('permissions')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Permission catalog grouped by resource' })
  permissions() {
    return this.rbac.permissions();
  }

  /**
   * PUT, not PATCH: the body is the complete grant list for the role, so the
   * request is idempotent and two admins editing different rows cannot merge
   * into a state neither chose.
   */
  @Put('roles/:id/permissions')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: "Replace a role's permissions (guardrails applied)" })
  setPermissions(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: RolePermissionsDto,
  ) {
    return this.rbac.setPermissions(user, id, dto.permissions);
  }
}
