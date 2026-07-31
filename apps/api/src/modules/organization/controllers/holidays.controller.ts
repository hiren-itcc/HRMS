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
import { HolidayCreateDto, HolidayQueryDto, HolidayUpdateDto } from '../dto/organization.dto';
import { orgCtx } from '../org-context';
import { HolidaysService } from '../services/holidays.service';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization/holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'List holidays (year/location filter, search, paginate)' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: HolidayQueryDto) {
    return this.holidays.list(user.orgId, query);
  }

  @Post()
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Create holiday' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: HolidayCreateDto) {
    return this.holidays.create(orgCtx(user), dto);
  }

  @Patch(':id')
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Update holiday' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: HolidayUpdateDto,
  ) {
    return this.holidays.update(orgCtx(user), id, dto);
  }

  @Delete(':id')
  @RequirePermissions('org.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete holiday' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.holidays.remove(orgCtx(user), id);
  }
}
