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
import { ListQueryDto, ShiftCreateDto, ShiftUpdateDto } from '../dto/organization.dto';
import { orgCtx } from '../org-context';
import { ShiftsService } from '../services/shifts.service';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization/shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'List shifts (search/sort/paginate)' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: ListQueryDto) {
    return this.shifts.list(user.orgId, query);
  }

  @Get('options')
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'Flat id/name list for pickers' })
  options(@CurrentUser() user: AccessTokenClaims) {
    return this.shifts.options(user.orgId);
  }

  @Post()
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Create shift' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: ShiftCreateDto) {
    return this.shifts.create(orgCtx(user), dto);
  }

  @Patch(':id')
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Update shift' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ShiftUpdateDto,
  ) {
    return this.shifts.update(orgCtx(user), id, dto);
  }

  @Delete(':id')
  @RequirePermissions('org.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete shift' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.shifts.remove(orgCtx(user), id);
  }
}
