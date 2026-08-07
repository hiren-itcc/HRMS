import {
  assetCategorySchema,
  assetCreateSchema,
  assetIssueSchema,
  assetQuerySchema,
  assetReturnSchema,
  assetStatusChangeSchema,
  assetUpdateSchema,
} from '@hrms/shared';
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
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AssetCategoriesService } from './asset-categories.service';
import { AssetsService } from './assets.service';

export class AssetCreateDto extends createZodDto(assetCreateSchema) {}
export class AssetUpdateDto extends createZodDto(assetUpdateSchema) {}
export class AssetIssueDto extends createZodDto(assetIssueSchema) {}
export class AssetReturnDto extends createZodDto(assetReturnSchema) {}
export class AssetStatusChangeDto extends createZodDto(assetStatusChangeSchema) {}
export class AssetCategoryDto extends createZodDto(assetCategorySchema) {}
export class AssetQueryDto extends createZodDto(assetQuerySchema) {}

/**
 * The asset register.
 *
 * `asset.assign` is separate from `asset.manage` throughout: buying and
 * retiring equipment is an admin job, handing a laptop to a joiner is not, and
 * an organization may well want IT doing the second without being able to
 * write off the first.
 *
 * Every static segment — `me`, `categories`, `employee` — is declared **before**
 * `:id`. Nest matches in declaration order, so a static route that arrives
 * second loses to the parameter above it.
 */
@ApiTags('assets')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly categories: AssetCategoriesService,
  ) {}

  @Get()
  @RequirePermissions('asset.read')
  @ApiOperation({ summary: 'The register — filter by category or status, search tag/serial/name' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: AssetQueryDto) {
    return this.assets.list(user, query);
  }

  /** Read-only, and no scope parameter: the register is IT's record. */
  @Get('me')
  @RequirePermissions('asset.read.own')
  @ApiOperation({ summary: 'What I am holding' })
  mine(@CurrentUser() user: AccessTokenClaims) {
    // Nobody without an employee record can be holding anything.
    return user.employeeId ? this.assets.heldBy(user.orgId, user.employeeId) : [];
  }

  // ── categories ────────────────────────────────────────────────────────

  @Get('categories')
  @RequirePermissions('asset.read')
  @ApiOperation({ summary: 'Categories, with how many assets each holds' })
  listCategories(@CurrentUser() user: AccessTokenClaims) {
    return this.categories.list(user);
  }

  @Post('categories')
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Add a category' })
  createCategory(@CurrentUser() user: AccessTokenClaims, @Body() body: AssetCategoryDto) {
    return this.categories.create(user, body);
  }

  @Patch('categories/:id')
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Rename a category' })
  updateCategory(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: AssetCategoryDto,
  ) {
    return this.categories.update(user, id, body);
  }

  @Delete('categories/:id')
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Remove a category — refused while assets are filed under it' })
  removeCategory(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.categories.remove(user, id);
  }

  // ── one person's holdings ─────────────────────────────────────────────

  @Get('employee/:employeeId')
  @RequirePermissions('asset.read')
  @ApiOperation({ summary: 'What one person is still holding' })
  heldBy(@CurrentUser() user: AccessTokenClaims, @Param('employeeId') employeeId: string) {
    return this.assets.heldBy(user.orgId, employeeId);
  }

  // ── one asset ─────────────────────────────────────────────────────────

  @Get(':id')
  @RequirePermissions('asset.read')
  @ApiOperation({ summary: 'One asset, with every spell somebody held it' })
  detail(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.assets.detail(user, id);
  }

  @Get(':id/activity')
  @RequirePermissions('asset.read')
  @ApiOperation({ summary: 'Who added, issued, took back and retired it' })
  activity(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.assets.activity(user, id);
  }

  @Post()
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Add an asset to the register' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() body: AssetCreateDto) {
    return this.assets.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Edit its details. Status moves through issue, return or status' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: AssetUpdateDto,
  ) {
    return this.assets.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Delete it — refused once anybody has held it. Retire instead' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.assets.remove(user, id);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('asset.assign')
  @ApiOperation({ summary: 'Hand it to somebody' })
  issue(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: AssetIssueDto,
  ) {
    return this.assets.issue(user, id, body);
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('asset.assign')
  @ApiOperation({ summary: 'Take it back, recording what condition it came back in' })
  return(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: AssetReturnDto,
  ) {
    return this.assets.return(user, id, body);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Mark it in repair, lost or retired — with a reason' })
  setStatus(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: AssetStatusChangeDto,
  ) {
    return this.assets.setStatus(user, id, body);
  }
}
