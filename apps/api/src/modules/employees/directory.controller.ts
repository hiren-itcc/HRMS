import type { AccessTokenClaims } from '@hrms/types';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DirectoryService } from './directory.service';
import { DirectoryQueryDto } from './dto/employee.dto';

/**
 * Separate from EmployeesController on purpose. That one serves the HR record
 * and is gated on `employee.read`; this one serves work contact details to
 * everybody. Keeping them apart means the two field sets can never be widened
 * into each other by accident.
 */
@ApiTags('directory')
@ApiBearerAuth()
@Controller('directory')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  @RequirePermissions('directory.read')
  @ApiOperation({ summary: 'Company directory — current colleagues, work details only' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: DirectoryQueryDto) {
    return this.directory.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('directory.read')
  @ApiOperation({ summary: "A colleague's work profile (no HR or personal data)" })
  profile(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.directory.profile(user, id);
  }
}
