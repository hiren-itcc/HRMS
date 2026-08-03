import type { DirectoryQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable, NotFoundException } from '@nestjs/common';
import { buildListArgs, searchWhere, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

/**
 * The company directory — work contact details for colleagues, and nothing
 * else.
 *
 * Everything here is a `select`, never an `include` or a spread of the row.
 * That is the whole security design: the Employee table also carries date of
 * birth, home address, personal email and a bank detail relation, and a
 * whitelist is the only shape where adding a column tomorrow cannot quietly
 * publish it to every employee in the company. Do not replace these with
 * `include`.
 */
const CARD_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  workEmail: true,
  department: { select: { name: true } },
  designation: { select: { title: true } },
  location: { select: { name: true } },
} as const;

const PROFILE_SELECT = {
  ...CARD_SELECT,
  phone: true,
  manager: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      avatarUrl: true,
    },
  },
} as const;

/**
 * Nobody is listed once they have left; a directory is a list of colleagues.
 * Nor before they arrive: an invited hire who has not accepted would otherwise
 * be able to read every colleague's work email before signing anything.
 */
const LISTED: Prisma.EmployeeWhereInput = {
  deletedAt: null,
  status: { notIn: ['EXITED', 'ONBOARDING'] },
};

@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(claims: AccessTokenClaims, query: DirectoryQuery) {
    const where: Prisma.EmployeeWhereInput = {
      organizationId: claims.orgId,
      ...LISTED,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...searchWhere(query.search, ['firstName', 'lastName', 'workEmail', 'employeeCode']),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        select: CARD_SELECT,
        ...buildListArgs(query, ['firstName', 'lastName', 'employeeCode'], 'firstName'),
      }),
      this.prisma.employee.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async profile(claims: AccessTokenClaims, id: string) {
    const employee = await this.prisma.employee.findFirst({
      // Scoped by organization, so an id from another tenant reads as missing.
      where: { id, organizationId: claims.orgId, ...LISTED },
      select: PROFILE_SELECT,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }
}
