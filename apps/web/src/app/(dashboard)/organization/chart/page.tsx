'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown, ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { IconAction } from '@/components/icon-action';
import { initials } from '@/features/employees/types';
import { companyApi, type OrgChartNode } from '@/features/organization/api';
import { ChartViewport } from '@/features/organization/components/chart-viewport';

/**
 * Screen 16 — the reporting tree.
 *
 * Top-down boxes with connectors, drawn by CSS pseudo-elements on the `<li>`s
 * (`.org-tree` in `globals.css`), so what a screen reader walks is still a
 * nested list and the toggles are still buttons in the normal tab order. Below
 * `md` the connectors switch off and it is an indented list, which is the only
 * shape a deep tree has ever had on a phone.
 *
 * **Several branches open at once**, each card opening and closing on its own.
 * That is only workable because `ChartViewport` can shrink the whole chart to
 * the window: a level is as wide as every expanded branch in it put together,
 * so before zoom existed the second open branch pushed the first off the screen
 * and one-at-a-time was the only readable option.
 *
 * The cards are portrait — photo, name, code, job title — for the same reason.
 * At 7rem apiece a row of eight fits where a row of three used to.
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

/** Everybody, for Expand all. */
function allIds(nodes: OrgChartNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...allIds(node.reports)]);
}

function Node({
  node,
  openIds,
  onToggle,
  hit,
  hitRef,
}: {
  node: OrgChartNode;
  openIds: ReadonlySet<string>;
  onToggle: (id: string, open: boolean) => void;
  hit: string | null;
  hitRef: RefObject<HTMLDivElement | null>;
}) {
  const isOpen = openIds.has(node.id);
  const hasReports = node.reports.length > 0;
  const isHit = hit === node.id;

  return (
    <li>
      <div
        ref={isHit ? hitRef : undefined}
        className={cn(
          'org-card flex items-center gap-2 py-1.5 md:flex-col md:gap-1 md:py-0',
          isHit && 'ring-2 ring-ring',
        )}
      >
        {hasReports ? (
          <IconAction
            label={`${isOpen ? 'Collapse' : 'Expand'} ${node.firstName} ${node.lastName}'s reports`}
            icon={isOpen ? ChevronDown : ChevronRight}
            size="icon-sm"
            className="org-toggle"
            expanded={isOpen}
            onClick={() => onToggle(node.id, !isOpen)}
          />
        ) : (
          // Keeps names in one column whether or not somebody has reports. Only
          // on the phone list — the portrait card centres everything anyway.
          <span className="size-8 shrink-0 md:hidden" aria-hidden />
        )}

        <EmployeeAvatar src={node.avatarUrl} fallback={initials(node)} className="size-9" />

        <div className="min-w-0 flex-1 text-left md:w-full md:flex-none md:text-center">
          <Link
            href={`/directory/${node.id}`}
            className="block truncate font-medium text-sm hover:underline md:line-clamp-2 md:whitespace-normal md:text-xs md:leading-tight"
          >
            {node.firstName} {node.lastName}
          </Link>
          {/* Portrait only. On the phone list the code is one more thing
              competing with the name for a line that is already short. */}
          <p className="hidden truncate text-[11px] text-muted-foreground tabular-nums md:block">
            {node.employeeCode}
          </p>
          <p className="truncate text-muted-foreground text-xs md:line-clamp-2 md:whitespace-normal md:text-[11px] md:leading-tight">
            {node.designation ?? '—'}
            {/* The department does not fit in 7rem, and the directory page has
                it. It stays on the phone list, where there is room. */}
            {node.department && <span className="md:hidden"> · {node.department}</span>}
          </p>
        </div>

        {hasReports && (
          <Badge
            variant="outline"
            // Out of flow on the portrait card, so a count costs no width.
            className="shrink-0 tabular-nums md:absolute md:top-1 md:right-1 md:gap-0.5 md:px-1 md:py-0"
          >
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
              openIds={openIds}
              onToggle={onToggle}
              hit={hit}
              hitRef={hitRef}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const [search, setSearch] = useState('');
  /*
   * Which branches are open. A set rather than the single root-to-leaf chain
   * this used to hold: branches no longer close each other.
   *
   * Closing a node removes only its own id, so its descendants keep whatever
   * state they had and are simply not rendered. Reopening therefore restores
   * the shape you left the branch in rather than collapsing it flat, which is
   * deliberate — re-drilling four levels to get back where you were is the kind
   * of thing that makes a chart tiring to use.
   */
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set([ORG]));
  /*
   * Which match is being looked at, remembered against the search it belongs
   * to. Storing the needle alongside the index means a new search starts at the
   * first hit by *derivation* — no effect that resets it, and so no render
   * where the old index is briefly pointed at the new results.
   */
  const [nav, setNav] = useState({ needle: '', index: 0 });
  /** Bumped when the chart's shape changes enough to be worth re-measuring. */
  const [fitKey, setFitKey] = useState(0);
  const hitRef = useRef<HTMLDivElement | null>(null);

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
   * A hit four levels down is no use if it stays hidden behind a folded branch,
   * but expanding the company to find one person is worse.
   */
  const hitIndex = nav.needle === needle ? nav.index : 0;
  const current = hits[Math.min(hitIndex, Math.max(hits.length - 1, 0))];
  const step = (delta: number) =>
    setNav({ needle, index: (hitIndex + delta + hits.length) % hits.length });

  // Pointing the tree at the match. Keyed on the match's id, so re-renders that
  // do not change which person is being looked at leave the branches alone.
  // The path is unioned in rather than replacing the set: finding somebody is
  // not a reason to close everything else.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the trigger
  useEffect(() => {
    if (current) setOpenIds((previous) => new Set([...previous, ...current.path]));
  }, [current?.id]);

  /*
   * …and then scrolling to it, which has to be a second effect: the one above
   * only queues the state change that renders the card, so at that point
   * `hitRef` is still pointing at nothing. Re-running on `openIds` is what
   * catches the render where the card finally exists.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the trigger
  useEffect(() => {
    if (!current) return;
    hitRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [current?.id, openIds]);

  const toggle = (id: string, open: boolean) =>
    setOpenIds((previous) => {
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  if (chart.isError) return <ErrorState onRetry={() => chart.refetch()} />;
  if (!chart.data) return <Skeleton className="h-96 w-full rounded-xl" />;

  const orgOpen = openIds.has(ORG);
  const total = chart.data.total;

  const collapseAll = () => setOpenIds(new Set([ORG]));
  const expandAll = () => {
    setOpenIds(new Set([ORG, ...allIds(chart.data.roots)]));
    // The whole company is almost always wider than the window, so this is the
    // one toggle worth re-fitting after. An ordinary card opening is not: a
    // chart that re-scales every time you click is disorienting.
    setFitKey((n) => n + 1);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {total} {total === 1 ? 'person' : 'people'}
          {chart.data.roots.length > 1 && ` · ${chart.data.roots.length} top-level`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
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
          <Button type="button" variant="outline" size="sm" onClick={expandAll}>
            Expand all
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={collapseAll}>
            Collapse all
          </Button>
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
        <ChartViewport fitKey={fitKey}>
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
              <div className="org-card flex items-center gap-2 py-1.5 md:flex-col md:gap-1 md:py-0">
                <IconAction
                  label={`${orgOpen ? 'Collapse' : 'Expand'} the top level`}
                  icon={orgOpen ? ChevronDown : ChevronRight}
                  size="icon-sm"
                  className="org-toggle"
                  expanded={orgOpen}
                  onClick={() => toggle(ORG, !orgOpen)}
                />
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Building2 className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 text-left md:w-full md:flex-none md:text-center">
                  <p className="truncate font-medium text-sm md:line-clamp-2 md:whitespace-normal md:text-xs md:leading-tight">
                    {company.data?.name ?? 'This company'}
                  </p>
                  <p className="truncate text-muted-foreground text-xs md:text-[11px] md:leading-tight">
                    {chart.data.roots.length} {chart.data.roots.length === 1 ? 'person' : 'people'}{' '}
                    at the top
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 tabular-nums md:absolute md:top-1 md:right-1 md:gap-0.5 md:px-1 md:py-0"
                >
                  <Users className="size-3" aria-hidden /> {total}
                </Badge>
              </div>

              {orgOpen && (
                <ul>
                  {roots.map((root) => (
                    <Node
                      key={root.id}
                      node={root}
                      openIds={openIds}
                      onToggle={toggle}
                      hit={current?.id ?? null}
                      hitRef={hitRef}
                    />
                  ))}
                </ul>
              )}
            </li>
          </ul>
        </ChartViewport>
      )}
    </section>
  );
}
