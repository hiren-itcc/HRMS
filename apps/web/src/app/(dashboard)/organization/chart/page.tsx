'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Input } from '@hrms/ui/components/input';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { IconAction } from '@/components/icon-action';
import { initials } from '@/features/employees/types';
import { companyApi, type OrgChartNode } from '@/features/organization/api';

/**
 * Screen 16 — the reporting tree, specified since the beginning.
 *
 * A tree rather than a graph drawing on purpose: it collapses, it reads on a
 * phone, and it works with a keyboard. A canvas org chart is prettier and is
 * the thing nobody can use on the device they actually have.
 */

function matches(node: OrgChartNode, needle: string): boolean {
  const hay =
    `${node.firstName} ${node.lastName} ${node.employeeCode} ${node.designation ?? ''} ${node.department ?? ''}`.toLowerCase();
  return hay.includes(needle);
}

/** A node is kept when it matches, or when anyone beneath it does. */
function filterTree(nodes: OrgChartNode[], needle: string): OrgChartNode[] {
  return nodes.flatMap((node) => {
    const reports = filterTree(node.reports, needle);
    if (!matches(node, needle) && reports.length === 0) return [];
    return [{ ...node, reports }];
  });
}

function Node({
  node,
  depth,
  expandAll,
}: {
  node: OrgChartNode;
  depth: number;
  expandAll: boolean;
}) {
  // Deep branches start closed so a big company opens to something readable.
  const [open, setOpen] = useState(depth < 2);
  const isOpen = expandAll || open;
  const hasReports = node.reports.length > 0;

  return (
    <li>
      <div className="flex items-center gap-2 py-1.5">
        {hasReports ? (
          <IconAction
            label={`${isOpen ? 'Collapse' : 'Expand'} ${node.firstName} ${node.lastName}'s reports`}
            icon={isOpen ? ChevronDown : ChevronRight}
            size="icon-sm"
            expanded={isOpen}
            onClick={() => setOpen(!isOpen)}
          />
        ) : (
          // Keeps names in one column whether or not somebody has reports.
          <span className="size-8 shrink-0" aria-hidden />
        )}

        <EmployeeAvatar src={node.avatarUrl} fallback={initials(node)} />

        <div className="min-w-0 flex-1">
          <Link
            href={`/directory/${node.id}`}
            className="truncate font-medium text-sm hover:underline"
          >
            {node.firstName} {node.lastName}
          </Link>
          <p className="truncate text-muted-foreground text-xs">
            {node.designation ?? '—'}
            {node.department && ` · ${node.department}`}
          </p>
        </div>

        {hasReports && (
          <Badge variant="outline" className="shrink-0 tabular-nums">
            <Users className="size-3" aria-hidden /> {node.totalReports}
          </Badge>
        )}
      </div>

      {hasReports && isOpen && (
        <ul className="ml-4 border-l pl-3">
          {node.reports.map((child) => (
            <Node key={child.id} node={child} depth={depth + 1} expandAll={expandAll} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const [search, setSearch] = useState('');
  const chart = useQuery({ queryKey: ['organization', 'chart'], queryFn: companyApi.chart });

  const needle = search.trim().toLowerCase();
  const roots = useMemo(
    () => (needle ? filterTree(chart.data?.roots ?? [], needle) : (chart.data?.roots ?? [])),
    [chart.data, needle],
  );

  if (chart.isError) return <ErrorState onRetry={() => chart.refetch()} />;
  if (!chart.data) return <Skeleton className="h-96 w-full rounded-xl" />;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {chart.data.total} {chart.data.total === 1 ? 'person' : 'people'}
          {chart.data.roots.length > 1 && ` · ${chart.data.roots.length} top-level`}
        </p>
        <div className="relative w-full sm:w-64">
          <Search
            className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-8"
            placeholder="Find someone"
            aria-label="Find someone in the org chart"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {roots.length === 0 ? (
        <EmptyState
          title={needle ? 'Nobody matches that' : 'No reporting lines yet'}
          hint={
            needle
              ? 'Try a name, employee code, job title or department.'
              : 'Set a reporting manager on an employee record and they appear here.'
          }
        />
      ) : (
        // Searching expands everything: a hit three levels down is no use
        // hidden inside a collapsed branch.
        <ul className="rounded-xl border p-2">
          {roots.map((root) => (
            <Node key={root.id} node={root} depth={0} expandAll={needle.length > 0} />
          ))}
        </ul>
      )}
    </section>
  );
}
