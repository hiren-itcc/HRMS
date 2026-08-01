import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RbacService } from './rbac.service';

class RolePermissionsDto extends createZodDto(
  z.object({ permissions: z.array(z.string()).max(200) }),
) {}

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
