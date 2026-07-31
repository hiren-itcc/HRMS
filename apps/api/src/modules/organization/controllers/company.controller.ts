import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CompanyUpdateDto } from '../dto/organization.dto';
import { orgCtx } from '../org-context';
import { CompanyService } from '../services/company.service';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  @RequirePermissions('org.read')
  @ApiOperation({ summary: 'Company profile' })
  get(@CurrentUser() user: AccessTokenClaims) {
    return this.company.get(user.orgId);
  }

  @Patch()
  @RequirePermissions('org.manage')
  @ApiOperation({ summary: 'Update company profile' })
  update(@CurrentUser() user: AccessTokenClaims, @Body() dto: CompanyUpdateDto) {
    return this.company.update(orgCtx(user), dto);
  }
}
