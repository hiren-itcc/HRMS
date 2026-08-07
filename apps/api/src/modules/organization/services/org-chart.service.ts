import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * The reporting tree (docs/03 `GET /organization/chart`, screen 16).
 *
 * Built in memory from one query rather than a recursive CTE. The roster is
 * already capped at a few thousand by every other read in this system, a tree
 * that size is a few milliseconds of Map work, and the alternative is raw SQL
 * that Prisma cannot type.
 */

export interface OrgChartNode {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  avatarUrl: string | null;
  /** Everybody below them, not just direct reports. Lets the UI show a count. */
  totalReports: number;
  reports: OrgChartNode[];
}

/**
 * Work contact facts only — the same whitelist the directory uses, for the same
 * reason. An org chart is a picture of who reports to whom, not a way for
 * anybody with `org.read` to read a personnel record.
 */
const SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  managerId: true,
  avatarUrl: true,
  designation: { select: { title: true } },
  department: { select: { name: true } },
} as const;

@Injectable()
export class OrgChartService {
  constructor(private readonly prisma: PrismaService) {}

  async get(orgId: string): Promise<{ roots: OrgChartNode[]; total: number }> {
    const rows = await this.prisma.employee.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        // Same rule as the directory: a chart is about who works here now.
        status: { notIn: ['EXITED', 'ONBOARDING'] },
      },
      select: SELECT,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const nodes = new Map<string, OrgChartNode>(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          employeeCode: r.employeeCode,
          designation: r.designation?.title ?? null,
          department: r.department?.name ?? null,
          avatarUrl: r.avatarUrl ?? null,
          totalReports: 0,
          reports: [],
        },
      ]),
    );

    const roots: OrgChartNode[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id) as OrgChartNode;
      const parent = row.managerId ? nodes.get(row.managerId) : undefined;
      /*
       * No manager, or a manager who is not in this set — someone reporting to
       * a person who has since left. They become a root rather than being
       * dropped: silently vanishing from the chart is how you end up believing
       * a department has three people in it.
       */
      if (parent) parent.reports.push(node);
      else roots.push(node);
    }

    /*
     * Depth-first with a visited set. Reporting cycles are refused on write
     * (`ensureNoManagerCycle`), so this should never fire — but "should never"
     * plus recursion is a hung request, and a chart is not worth one.
     */
    const seen = new Set<string>();
    const countBelow = (node: OrgChartNode): number => {
      if (seen.has(node.id)) {
        node.reports = [];
        return 0;
      }
      seen.add(node.id);
      node.totalReports = node.reports.reduce((sum, child) => sum + 1 + countBelow(child), 0);
      return node.totalReports;
    };
    for (const root of roots) countBelow(root);

    return { roots, total: rows.length };
  }
}
