import { EMPLOYEE_IMPORT_COLUMNS, type EmployeeQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf } from '../../common/utils/calendar';
import { PrismaService } from '../../database/prisma.service';
import { type ExportPayload, serializeReport } from '../reports/report-export';
import { EmployeesService } from './employees.service';

/**
 * The employee list, as a file.
 *
 * The serialiser is `report-export.ts` unchanged — it already handles CSV,
 * SpreadsheetML, the UTF-8 byte-order mark Excel needs, and the CSV-injection
 * guard, which matters more here than in a payroll report because these cells
 * are names people typed.
 *
 * **The columns are `EMPLOYEE_IMPORT_COLUMNS`**, deliberately the same list the
 * importer reads. That is what makes "export it, fix two cells, import it back"
 * work at all, and it means the two can never drift into a shape where the
 * product can write a file it cannot read.
 *
 * **Bank details are absent, in both directions.** An account number in a
 * spreadsheet that gets emailed around is an incident, and `EmployeesService`
 * already treats bank details as the most restricted field in the product — an
 * export carrying them would be a second, unguarded path to them.
 */
@Injectable()
export class EmployeeExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
  ) {}

  async export(
    claims: AccessTokenClaims,
    query: EmployeeQuery,
    format: 'csv' | 'excel',
  ): Promise<ExportPayload & { filename: string }> {
    /*
     * Through the list service, so the export sees exactly what the screen
     * sees — including the manager scoping. An export that read Prisma directly
     * would be a second, unscoped answer to "who may I see", which is the
     * shape of every accidental data leak in a product like this.
     */
    const employees = await this.employees.exportRows(claims, query);
    const rows = employees.map((employee) => ({
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      workEmail: employee.workEmail,
      personalEmail: employee.personalEmail ?? '',
      phone: employee.phone ?? '',
      dateOfBirth: employee.dateOfBirth ? dateKeyOf(employee.dateOfBirth) : '',
      gender: employee.gender ?? '',
      joinDate: employee.joinDate ? dateKeyOf(employee.joinDate) : '',
      department: employee.department?.name ?? '',
      designation: employee.designation?.title ?? '',
      location: employee.location?.name ?? '',
      shift: employee.shift?.name ?? '',
      employmentType: employee.employmentType?.name ?? '',
      // The manager as their **code**, not their name: a name may be ambiguous
      // and the importer refuses an ambiguous one rather than guessing, so a
      // round trip has to survive two people called the same thing.
      manager: employee.manager?.employeeCode ?? '',
    }));

    const columns = EMPLOYEE_IMPORT_COLUMNS.map((c) => ({ key: c.key, header: c.header }));
    const payload = serializeReport(format, columns, rows, 'Employees');

    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'employee.export',
      'Employee',
      'bulk',
      { after: { rows: rows.length, format } },
    );

    return { ...payload, filename: `employees.${payload.extension}` };
  }
}
