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
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  BankDetailDto,
  EmployeeConfirmDto,
  EmployeeCreateDto,
  EmployeeExtendProbationDto,
  EmployeeOffboardDto,
  EmployeeQueryDto,
  EmployeeRoleChangeDto,
  EmployeeUpdateDto,
  SelfProfileUpdateDto,
} from './dto/employee.dto';
import { EmployeeAvatarService } from './employee-avatar.service';
import { EmployeesService } from './employees.service';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly avatars: EmployeeAvatarService,
  ) {}

  @Get()
  @RequirePermissions('employee.read', 'employee.read.team')
  @ApiOperation({ summary: 'List employees — org-wide (HR/Admin) or direct reports (manager)' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: EmployeeQueryDto) {
    return this.employees.list(user, query);
  }

  @Get('options')
  @RequirePermissions('employee.read')
  @ApiOperation({ summary: 'Flat list for manager pickers' })
  options(@CurrentUser() user: AccessTokenClaims) {
    return this.employees.options(user.orgId);
  }

  @Get(':id')
  @RequirePermissions('employee.read', 'employee.read.team', 'employee.read.own')
  @ApiOperation({ summary: 'Employee detail (bank details for HR/Admin and self only)' })
  detail(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.employees.detail(user, id);
  }

  @Post()
  @RequirePermissions('employee.create')
  @ApiOperation({ summary: 'Create employee (employeeCode auto-generated when omitted)' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: EmployeeCreateDto) {
    return this.employees.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('employee.update')
  @ApiOperation({ summary: 'Update employee' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: EmployeeUpdateDto,
  ) {
    return this.employees.update(user, id, dto);
  }

  @Patch(':id/role')
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: "Change the role on an employee's login (Admin only)" })
  changeRole(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: EmployeeRoleChangeDto,
  ) {
    return this.employees.changeRole(user, id, dto.roleCode);
  }

  @Post(':id/offboard')
  @RequirePermissions('employee.offboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Put somebody on notice, mark them exited, or withdraw a resignation',
  })
  offboard(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: EmployeeOffboardDto,
  ) {
    return this.employees.offboard(user, id, dto);
  }

  @Get(':id/activity')
  @RequirePermissions('employee.read', 'employee.read.team', 'employee.read.own')
  @ApiOperation({ summary: 'Employment history — every recorded change to this record' })
  activity(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.employees.activity(user, id);
  }

  @Post(':id/confirm')
  @RequirePermissions('employee.confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm somebody off probation' })
  confirm(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: EmployeeConfirmDto,
  ) {
    return this.employees.confirm(user, id, dto);
  }

  @Post(':id/extend-probation')
  @RequirePermissions('employee.confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Push a probation end date back, with a reason' })
  extendProbation(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: EmployeeExtendProbationDto,
  ) {
    return this.employees.extendProbation(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('employee.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete employee; suspends linked login and revokes sessions' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.employees.softDelete(user, id);
  }

  @Put(':id/bank')
  @RequirePermissions('employee.update')
  @ApiOperation({ summary: 'Create or replace bank details' })
  upsertBank(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: BankDetailDto,
  ) {
    return this.employees.upsertBank(user, id, dto);
  }

  // ── Profile photo ──────────────────────────────────────────────────────
  //
  // No `@RequirePermissions` on the two writes: whether this costs
  // `employee.update.own` or `employee.update` depends on whose record it is,
  // which the guard cannot see. The service decides — see `assertMayWrite`.

  @Get(':id/avatar')
  @RequirePermissions('directory.read')
  @ApiOperation({ summary: 'The photo itself — 404 when there is none, so initials show' })
  async avatar(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, mimeType } = await this.avatars.open(user, id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', 'inline');
    /*
     * The one header that matters here. The stored content type is derived
     * from a validated mimetype, but a file whose *bytes* are not an image
     * could still be sniffed into something executable without this.
     */
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The URL carries a hash of the storage key, so a new photo is a new URL
    // and this can be cached hard.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    return new StreamableFile(stream);
  }

  @Post(':id/avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: "Set somebody's photo — HR; needs employee.update" })
  setAvatar(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.avatars.set(user, id, file);
  }

  @Delete(':id/avatar')
  @ApiOperation({ summary: 'Take the photo down; initials come back on their own' })
  removeAvatar(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.avatars.remove(user, id);
  }
}

/** Self-service profile — scope comes from the JWT, no permission matrix needed. */
@ApiTags('employees')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly avatars: EmployeeAvatarService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Own employee profile incl. bank details' })
  myProfile(@CurrentUser() user: AccessTokenClaims) {
    return this.employees.myProfile(user);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update own contact fields (phone, personal email, address)' })
  updateMyProfile(@CurrentUser() user: AccessTokenClaims, @Body() dto: SelfProfileUpdateDto) {
    return this.employees.updateMyProfile(user, dto);
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Set your own photo — needs employee.update.own' })
  setMyAvatar(@CurrentUser() user: AccessTokenClaims, @UploadedFile() file: Express.Multer.File) {
    return this.avatars.setForSelf(user, file);
  }

  @Delete('avatar')
  @ApiOperation({ summary: 'Take your own photo down' })
  removeMyAvatar(@CurrentUser() user: AccessTokenClaims) {
    return this.avatars.removeForSelf(user);
  }
}
