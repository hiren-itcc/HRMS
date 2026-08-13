import {
  projectCreateSchema,
  projectMemberCreateSchema,
  projectMemberUpdateSchema,
  projectQuerySchema,
  projectUpdateSchema,
  utilisationQuerySchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProjectsService } from './projects.service';

export class ProjectCreateDto extends createZodDto(projectCreateSchema) {}
export class ProjectUpdateDto extends createZodDto(projectUpdateSchema) {}
export class ProjectQueryDto extends createZodDto(projectQuerySchema) {}
export class ProjectMemberCreateDto extends createZodDto(projectMemberCreateSchema) {}
export class ProjectMemberUpdateDto extends createZodDto(projectMemberUpdateSchema) {}
export class UtilisationQueryDto extends createZodDto(utilisationQuerySchema) {}

/**
 * The project register (docs/03-api-structure.md §projects).
 *
 * Read routes carry the weakest code that could reach them — `project.read.own`
 * — and the service narrows from the token's scope, because the guard cannot
 * know whether an id belongs to a project you are on. An unreadable project
 * answers 404, not 403.
 *
 * The staffing routes are gated `project.manage`, and the service *also* lets a
 * project's own manager through without it. The guard is the floor, not the
 * whole rule: see `assertMayManage`.
 */
@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions('project.read.own')
  @ApiOperation({ summary: 'Projects I am on, or every project' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: ProjectQueryDto) {
    return this.projects.list(user, query);
  }

  @Post()
  @RequirePermissions('project.manage')
  @ApiOperation({ summary: 'Open a project' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: ProjectCreateDto) {
    return this.projects.create(user, dto);
  }

  /* Declared before ':id' so 'reports' is not read as a project id. */
  @Get('reports/utilisation')
  @RequirePermissions('project.read')
  @ApiOperation({ summary: 'Hours per person per project over a range' })
  utilisation(@CurrentUser() user: AccessTokenClaims, @Query() query: UtilisationQueryDto) {
    return this.projects.utilisation(user, query);
  }

  /* Also before ':id', for the same reason. */
  @Patch('members/:memberId')
  @RequirePermissions('project.read.own')
  @ApiOperation({ summary: 'Change somebody’s role, allocation or dates' })
  updateMember(
    @CurrentUser() user: AccessTokenClaims,
    @Param('memberId') memberId: string,
    @Body() dto: ProjectMemberUpdateDto,
  ) {
    return this.projects.updateMember(user, memberId, dto);
  }

  @Delete('members/:memberId')
  @RequirePermissions('project.read.own')
  @ApiOperation({ summary: 'Take somebody off, if they have logged nothing' })
  removeMember(@CurrentUser() user: AccessTokenClaims, @Param('memberId') memberId: string) {
    return this.projects.removeMember(user, memberId);
  }

  @Get(':id')
  @RequirePermissions('project.read.own')
  @ApiOperation({ summary: 'One project and who is on it' })
  get(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.projects.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions('project.read.own')
  @ApiOperation({ summary: 'Edit a project' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ProjectUpdateDto,
  ) {
    return this.projects.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('project.manage')
  @ApiOperation({ summary: 'Delete a project, if nothing was logged against it' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.projects.remove(user, id);
  }

  @Post(':id/members')
  @RequirePermissions('project.read.own')
  @ApiOperation({ summary: 'Staff somebody onto a project' })
  addMember(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: ProjectMemberCreateDto,
  ) {
    return this.projects.addMember(user, id, dto);
  }
}
