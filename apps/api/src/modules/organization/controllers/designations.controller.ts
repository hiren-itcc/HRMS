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
import { DesignationCreateDto, DesignationUpdateDto, ListQueryDto } from '../dto/organization.dto';
import { orgCtx } from '../org-context';
import { DesignationsService } from '../services/designations.service';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization/designations')
export class DesignationsController {
  constructor(private readonly designations: DesignationsService) {}

  @Get()
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'List designations (search/sort/paginate)' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: ListQueryDto) {
    return this.designations.list(user.orgId, query);
  }

  @Get('options')
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'Flat id/title list for pickers' })
  options(@CurrentUser() user: AccessTokenClaims) {
    return this.designations.options(user.orgId);
  }

  @Post()
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Create designation' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: DesignationCreateDto) {
    return this.designations.create(orgCtx(user), dto);
  }

  @Patch(':id')
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Update designation' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: DesignationUpdateDto,
  ) {
    return this.designations.update(orgCtx(user), id, dto);
  }

  @Delete(':id')
  @RequirePermissions('org.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete designation' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.designations.remove(orgCtx(user), id);
  }
}
