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
import {
  EmploymentTypeCreateDto,
  EmploymentTypeUpdateDto,
  ListQueryDto,
} from '../dto/organization.dto';
import { orgCtx } from '../org-context';
import { EmploymentTypesService } from '../services/employment-types.service';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization/employment-types')
export class EmploymentTypesController {
  constructor(private readonly employmentTypes: EmploymentTypesService) {}

  @Get()
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'List employment types (search/sort/paginate)' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: ListQueryDto) {
    return this.employmentTypes.list(user.orgId, query);
  }

  @Post()
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Create employment type' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: EmploymentTypeCreateDto) {
    return this.employmentTypes.create(orgCtx(user), dto);
  }

  @Patch(':id')
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Update employment type' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: EmploymentTypeUpdateDto,
  ) {
    return this.employmentTypes.update(orgCtx(user), id, dto);
  }

  @Delete(':id')
  @RequirePermissions('org.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete employment type' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.employmentTypes.remove(orgCtx(user), id);
  }
}
