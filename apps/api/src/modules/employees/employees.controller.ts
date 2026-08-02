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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  BankDetailDto,
  EmployeeCreateDto,
  EmployeeQueryDto,
  EmployeeRoleChangeDto,
  EmployeeUpdateDto,
  SelfProfileUpdateDto,
} from './dto/employee.dto';
import { EmployeesService } from './employees.service';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

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
}

/** Self-service profile — scope comes from the JWT, no permission matrix needed. */
@ApiTags('employees')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly employees: EmployeesService) {}

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
}
