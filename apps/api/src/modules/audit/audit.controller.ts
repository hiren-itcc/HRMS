import { auditQuerySchema } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditService } from './audit.service';

export class AuditQueryDto extends createZodDto(auditQuerySchema) {}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Audit trail — who changed what, filterable' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: AuditQueryDto) {
    return this.audit.list(user, query);
  }

  @Get('facets')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Distinct actions and entities, for the filter dropdowns' })
  facets(@CurrentUser() user: AccessTokenClaims) {
    return this.audit.facets(user);
  }
}
