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
import { LocationCreateDto, LocationQueryDto, LocationUpdateDto } from '../dto/organization.dto';
import { orgCtx } from '../org-context';
import { LocationsService } from '../services/locations.service';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization/locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'List locations/branches (search/filter/sort/paginate)' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: LocationQueryDto) {
    return this.locations.list(user.orgId, query);
  }

  @Get('options')
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'Flat id/name list for pickers' })
  options(@CurrentUser() user: AccessTokenClaims) {
    return this.locations.options(user.orgId);
  }

  @Post()
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Create location/branch' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: LocationCreateDto) {
    return this.locations.create(orgCtx(user), dto);
  }

  @Patch(':id')
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Update location/branch' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: LocationUpdateDto,
  ) {
    return this.locations.update(orgCtx(user), id, dto);
  }

  @Delete(':id')
  @RequirePermissions('org.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete location/branch' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.locations.remove(orgCtx(user), id);
  }
}
