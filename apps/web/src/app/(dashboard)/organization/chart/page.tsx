'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Input } from '@hrms/ui/components/input';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown, ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { IconAction } from '@/components/icon-action';
import { initials } from '@/features/employees/types';
import { companyApi, type OrgChartNode } from '@/features/organization/api';

/**
 * Screen 16 — the reporting tree.
 *
 * Top-down boxes with connectors, drawn by CSS pseudo-elements on the `<li>`s
 * (`.org-tree` in `globals.css`), so what a screen reader walks is still a
 * nested list and the toggles are still buttons in the normal tab order. Below
 * `md` the connectors switch off and it is an indented list, which is the only
 * shape a deep tree has ever had on a phone.
 *
 * **One branch is open at a time.** Opening a card closes whatever else was
 * open, and the chart starts with only the organization's own top level
 * showing. The first version of this drew the whole company at once and was
 * unreadable at twenty-three people: the width of a level is the sum of every
 * expanded branch at that level, so "expand everything" is the one thing a
 * top-down chart cannot do.
 */

/** The synthetic root. Not an employee, so it gets its own id rather than a fake one. */
const ORG = '__org__';

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

/** Every match, each with the chain of ids that reaches it — depth first, in reading order. */
function findMatches(
  nodes: OrgChartNode[],
  needle: string,
  parents: string[] = [ORG],
): { id: string; path: string[] }[] {
  return nodes.flatMap((node) => {
    const path = [...parents, node.id];
    const here = matches(node, needle) ? [{ id: node.id, path }] : [];
    return [...here, ...findMatches(node.reports, needle, path)];
  });
}

function Node({
  node,
  path,
  openPath,
  onToggle,
  hit,
}: {
  node: OrgChartNode;
  /** Ids from the organization down to this node, inclusive. */
  path: string[];
  openPath: string[];
  onToggle: (path: string[], open: boolean) => void;
  hit: string | null;
}) {
  /*
   * `openPath` is a single root-to-leaf chain, and ids are unique, so
   * membership is the whole test — no need to compare the chains position by
   * position.
   */
  const isOpen = openPath.includes(node.id);
  const hasReports = node.reports.length > 0;

  return (
    <li>
      <div
        className={cn(
          'org-card flex items-center gap-2 py-1.5',
          hit === node.id && 'ring-2 ring-ring',
        )}
      >
        {hasReports ? (
          <IconAction
            label={`${isOpen ? 'Collapse' : 'Expand'} ${node.firstName} ${node.lastName}'s reports`}
            icon={isOpen ? ChevronDown : ChevronRight}
            size="icon-sm"
            expanded={isOpen}
            onClick={() => onToggle(path, !isOpen)}
          />
        ) : (
          // Keeps names in one column whether or not somebody has reports.
          <span className="size-8 shrink-0 md:hidden" aria-hidden />
        )}

        <EmployeeAvatar src={node.avatarUrl} fallback={initials(node)} className="size-9" />

        <div className="min-w-0 flex-1 text-left">
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
            <Node
              key={child.id}
              node={child}
              path={[...path, child.id]}
              openPath={openPath}
              onToggle={onToggle}
              hit={hit}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const [search, setSearch] = useState('');
  const [openPath, setOpenPath] = useState<string[]>([ORG]);
  /*
   * Which match is being looked at, remembered against the search it belongs
   * to. Storing the needle alongside the index means a new search starts at the
   * first hit by *derivation* — no effect that resets it, and so no render
   * where the old index is briefly pointed at the new results.
   */
  const [nav, setNav] = useState({ needle: '', index: 0 });

  const chart = useQuery({ queryKey: ['organization', 'chart'], queryFn: companyApi.chart });
  const company = useQuery({ queryKey: ['organization', 'company'], queryFn: companyApi.get });

  const needle = search.trim().toLowerCase();
  const roots = useMemo(
    () => (needle ? filterTree(chart.data?.roots ?? [], needle) : (chart.data?.roots ?? [])),
    [chart.data, needle],
  );
  const hits = useMemo(
    () => (needle ? findMatches(chart.data?.roots ?? [], needle) : []),
    [chart.data, needle],
  );

  /*
   * Searching opens the way down to a match rather than expanding everything.
   * Expanding everything is what made the first version unreadable, and a hit
   * four levels down is no use if the answer is a wall of cards either side of
   * it.
   */
  const hitIndex = nav.needle === needle ? nav.index : 0;
  const current = hits[Math.min(hitIndex, Math.max(hits.length - 1, 0))];
  const step = (delta: number) =>
    setNav({ needle, index: (hitIndex + delta + hits.length) % hits.length });

  // The one thing that genuinely is a side effect: pointing the tree at the
  // match. Keyed on the match's id, so re-renders that do not change which
  // person is being looked at leave the branches alone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the trigger
  useEffect(() => {
    if (current) setOpenPath(current.path);
  }, [current?.id]);

  const toggle = (path: string[], open: boolean) => {
    // Opening replaces the whole chain, which is what closes the other branch;
    // closing drops just this node and leaves its ancestors open.
    setOpenPath(open ? path : path.slice(0, -1));
  };

  if (chart.isError) return <ErrorState onRetry={() => chart.refetch()} />;
  if (!chart.data) return <Skeleton className="h-96 w-full rounded-xl" />;

  const orgOpen = openPath.includes(ORG);
  const total = chart.data.total;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {total} {total === 1 ? 'person' : 'people'}
          {chart.data.roots.length > 1 && ` · ${chart.data.roots.length} top-level`}
        </p>

        <div className="flex items-center gap-2">
          {needle && hits.length > 0 && (
            <div className="flex items-center gap-1 text-muted-foreground text-sm">
              <span className="tabular-nums">
                {Math.min(hitIndex + 1, hits.length)} of {hits.length}
              </span>
              <IconAction
                label="Previous match"
                icon={ChevronLeft}
                size="icon-sm"
                disabled={hits.length < 2}
                onClick={() => step(-1)}
              />
              <IconAction
                label="Next match"
                icon={ChevronRight}
                size="icon-sm"
                disabled={hits.length < 2}
                onClick={() => step(1)}
              />
            </div>
          )}
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
        // Scrolls sideways rather than squashing: a level as wide as its widest
        // sibling group is still sometimes wider than a screen, and shrinking
        // the cards to fit would make none of them readable.
        <div className="overflow-x-auto pb-2">
          <ul className="org-tree">
            {/*
              The company, as the one root. Not a person — it has no first name,
              no job title and no directory page — so it is its own card rather
              than an OrgChartNode with the fields left blank.

              It is also what stops several top-level people being laid out in a
              row and pushed off the side. It does not promote anybody: nobody
              is being drawn as the boss, the company is.
            */}
            <li>
              <div className="org-card flex items-center gap-2 py-1.5">
                <IconAction
                  label={`${orgOpen ? 'Collapse' : 'Expand'} the top level`}
                  icon={orgOpen ? ChevronDown : ChevronRight}
                  size="icon-sm"
                  expanded={orgOpen}
                  onClick={() => toggle([ORG], !orgOpen)}
                />
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Building2 className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium text-sm">
                    {company.data?.name ?? 'This company'}
                  </p>
                  <p className="truncate text-muted-foreground text-xs">
                    {chart.data.roots.length} {chart.data.roots.length === 1 ? 'person' : 'people'}{' '}
                    at the top
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  <Users className="size-3" aria-hidden /> {total}
                </Badge>
              </div>

              {orgOpen && (
                <ul>
                  {roots.map((root) => (
                    <Node
                      key={root.id}
                      node={root}
                      path={[ORG, root.id]}
                      openPath={openPath}
                      onToggle={toggle}
                      hit={current?.id ?? null}
                    />
                  ))}
                </ul>
              )}
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}
