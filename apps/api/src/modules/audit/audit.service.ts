import type { AuditEntry, AuditQuery } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable } from '@nestjs/common';
import { toDate } from '../../common/utils/calendar';
import { toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(claims: AccessTokenClaims, query: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: claims.orgId,
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      // A family filter ("leave") matches every leave.* action. Actions are
      // dot-namespaced by convention, so a prefix match is exact enough.
      ...(query.resource && !query.action ? { action: { startsWith: `${query.resource}.` } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: toDate(query.from) } : {}),
              // `to` is a date, so include the whole day.
              ...(query.to ? { lt: addDays(query.to, 1) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return toPaginated(await this.withActors(rows), total, query);
  }

  /**
   * AuditLog has no foreign keys — deliberately, so rows survive the deletion
   * of the user who caused them. That means actor names need a second query,
   * and a missing user is a "—", never a crash.
   */
  private async withActors(
    rows: {
      id: string;
      action: string;
      entity: string;
      entityId: string | null;
      meta: unknown;
      ip: string | null;
      actorId: string | null;
      createdAt: Date;
    }[],
  ): Promise<AuditEntry[]> {
    const ids = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => id !== null))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows.map((row) => {
      const user = row.actorId ? byId.get(row.actorId) : undefined;
      return {
        id: row.id,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        meta: (row.meta as Record<string, unknown> | null) ?? null,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
        actor: user
          ? {
              id: user.id,
              email: user.email,
              name: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : null,
            }
          : null,
      };
    });
  }

  /** Distinct actions and entities present, so the filters offer real values. */
  async facets(claims: AccessTokenClaims) {
    const [actions, entities] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where: { organizationId: claims.orgId },
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: { organizationId: claims.orgId },
        distinct: ['entity'],
        select: { entity: true },
        orderBy: { entity: 'asc' },
      }),
    ]);
    return {
      actions: actions.map((a) => a.action),
      entities: entities.map((e) => e.entity),
    };
  }
}

function addDays(dateKey: string, days: number): Date {
  const date = toDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}
