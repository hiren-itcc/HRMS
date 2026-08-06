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
 * Top-down boxes with connectors, which is what an org chart is expected to
 * look like — but still a `<ul>` of `<li>`s, still collapsing, still operable
 * from a keyboard, and still an indented list below `md` where a wide tree
 * would need two-finger scrolling. The connectors are drawn by CSS pseudo-
 * elements (`.org-tree` in `globals.css`), so nothing here is a canvas, an SVG
 * or a layout library, and the markup a screen reader walks is unchanged.
 *
 * That is the whole trick: the earlier version of this comment argued against
 * a canvas org chart because it "is the thing nobody can use on the device
 * they actually have". Still true. This is the picture without the canvas.
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
      {/*
        `org-card` is the box and its connector anchor; everything else here is
        ordinary Tailwind. On a phone the border and background fall away and
        this is a row in an indented list again.
      */}
      <div className="org-card flex items-center gap-2 py-1.5">
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
          <span className="size-8 shrink-0 md:hidden" aria-hidden />
        )}

        <EmployeeAvatar src={node.avatarUrl} fallback={initials(node)} className="size-9" />

        <div className="min-w-0 flex-1">
          <Link
            href={`/directory/${node.id}`}
            className="block truncate font-medium text-sm hover:underline"
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
        <ul>
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
        // Two things at once: searching expands everything, because a hit
        // three levels down is no use hidden inside a collapsed branch — and
        // the tree scrolls sideways rather than squashing, because a wide org
        // is wide and shrinking the cards to fit makes none of them readable.
        <div className="overflow-x-auto pb-2">
          <ul className="org-tree">
            {roots.map((root) => (
              <Node key={root.id} node={root} depth={0} expandAll={needle.length > 0} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
