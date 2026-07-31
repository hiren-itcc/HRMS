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
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { DepartmentCreateDto, DepartmentUpdateDto, ListQueryDto } from '../dto/organization.dto';
import { orgCtx } from '../org-context';
import { DepartmentsService } from '../services/departments.service';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization/departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'List departments (search/sort/paginate)' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: ListQueryDto) {
    return this.departments.list(user.orgId, query);
  }

  @Get('options')
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'Flat id/name list for pickers' })
  options(@CurrentUser() user: AccessTokenClaims) {
    return this.departments.options(user.orgId);
  }

  @Post()
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Create department' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: DepartmentCreateDto) {
    return this.departments.create(orgCtx(user), dto);
  }

  @Patch(':id')
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Update department' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: DepartmentUpdateDto,
  ) {
    return this.departments.update(orgCtx(user), id, dto);
  }

  @Delete(':id')
  @RequirePermissions('org.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete department' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.departments.remove(orgCtx(user), id);
  }
}
