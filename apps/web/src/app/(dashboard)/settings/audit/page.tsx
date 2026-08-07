'use client';

import type { AuditEntry } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { DatePicker } from '@hrms/ui/components/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { Suspense, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { FadeInItem, Stagger } from '@/components/motion';
import { actionLabel, actionResource, auditApi, relativeTime } from '@/features/settings/audit-api';
import { useListParams } from '@/hooks/use-list-params';

const ALL = 'all';
const PAGE_SIZE = 20;

/*
 * Fixed colours per action family so a scan finds the destructive ones fast.
 * Nine families is more than the design system's five categorical slots
 * (--chart-1..5), so these stay raw palette steps rather than being forced
 * onto semantic tokens that don't mean "action family".
 *
 * The light steps are -700, not -600: each label sits on a 10% tint of its own
 * hue, and against the cream card the -600 steps read 2.82–3.87:1 for six of
 * the nine. The -700 steps clear 4.5:1 (amber needed -800 at 6.27:1; its -700
 * reached only 4.44:1). Dark-mode -400 steps were already 4.61–9.20:1.
 */
const FAMILY_TONE: Record<string, string> = {
  auth: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  employee: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
  attendance: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  leave: 'bg-amber-500/10 text-amber-800 dark:text-amber-400',
  document: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  announcement: 'bg-pink-500/10 text-pink-700 dark:text-pink-400',
  org: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  settings: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  report: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  // Same recipe as the rest: a 10% tint of the hue, -700 in light and -400 in
  // dark. Without these two the exit rows fall through to the grey default and
  // read as though they belong to no module.
  resignation: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  offboarding: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
};

function MetaRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = entry.meta !== null || entry.ip !== null;
  if (!hasDetail) {
    return <span className="text-muted-foreground text-xs">{entry.entityId ?? '—'}</span>;
  }
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded text-muted-foreground text-xs hover:text-foreground focus-visible:outline-2"
      >
        {entry.entityId ?? 'details'}
        <ChevronDown
          className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <pre className="max-w-md overflow-x-auto rounded-lg bg-muted p-2 text-[11px] leading-relaxed">
          {JSON.stringify({ ip: entry.ip, ...entry.meta }, null, 1)}
        </pre>
      )}
    </div>
  );
}

function AuditView() {
  const params = useListParams('createdAt');
  const resource = params.get('resource');
  const entity = params.get('entity');
  const from = params.get('from');
  const to = params.get('to');

  const facets = useQuery({
    queryKey: ['audit-facets'],
    queryFn: auditApi.facets,
    staleTime: 300_000,
  });

  const list = useQuery({
    queryKey: ['audit', params.page, resource, entity, from, to],
    queryFn: () =>
      auditApi.list({
        page: params.page,
        limit: PAGE_SIZE,
        resource: resource ?? undefined,
        entity: entity ?? undefined,
        from: from ?? undefined,
        to: to ?? undefined,
      }),
  });

  const families = [...new Set((facets.data?.actions ?? []).map(actionResource))].sort();
  const hasFilters = Boolean(resource || entity || from || to);

  return (
    <Stagger className="space-y-4">
      <FadeInItem className="flex flex-wrap items-center gap-2">
        <Select
          value={resource ?? ALL}
          onValueChange={(v) => params.setFilter('resource', v === ALL ? undefined : v)}
        >
          <SelectTrigger className="w-44" aria-label="Filter by area">
            <SelectValue placeholder="All areas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All areas</SelectItem>
            {families.map((f) => (
              <SelectItem key={f} value={f} className="capitalize">
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={entity ?? ALL}
          onValueChange={(v) => params.setFilter('entity', v === ALL ? undefined : v)}
        >
          <SelectTrigger className="w-44" aria-label="Filter by record type">
            <SelectValue placeholder="All records" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All records</SelectItem>
            {(facets.data?.entities ?? []).map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <DatePicker
            value={from ?? ''}
            max={to}
            placeholder="From"
            onValueChange={(value) => params.setFilter('from', value || undefined)}
            className="w-full min-w-40 flex-1 sm:w-44 sm:flex-none"
            aria-label="From date"
          />
          <span className="text-muted-foreground text-sm" aria-hidden>
            →
          </span>
          <DatePicker
            value={to ?? ''}
            min={from}
            placeholder="To"
            onValueChange={(value) => params.setFilter('to', value || undefined)}
            className="w-full min-w-40 flex-1 sm:w-44 sm:flex-none"
            aria-label="To date"
          />
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              params.setFilters({
                resource: undefined,
                entity: undefined,
                from: undefined,
                to: undefined,
              })
            }
          >
            Clear
          </Button>
        )}
      </FadeInItem>

      <FadeInItem>
        <DataTable
          columns={[
            {
              key: 'actor',
              header: 'Who',
              render: (row: AuditEntry) => (
                <span className="block min-w-0">
                  <span className="block truncate font-medium text-sm">
                    {row.actor?.name ?? row.actor?.email ?? 'System'}
                  </span>
                  {row.actor?.name && (
                    <span className="block truncate text-muted-foreground text-xs">
                      {row.actor.email}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'action',
              header: 'Action',
              render: (row: AuditEntry) => {
                const family = actionResource(row.action);
                return (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="secondary"
                      className={`capitalize ${FAMILY_TONE[family] ?? 'bg-muted text-muted-foreground'}`}
                    >
                      {family}
                    </Badge>
                    <span className="text-sm">{actionLabel(row.action)}</span>
                  </span>
                );
              },
            },
            {
              key: 'entity',
              header: 'Record',
              className: 'hidden md:table-cell',
              render: (row: AuditEntry) => (
                <span className="block">
                  <span className="block text-sm">{row.entity}</span>
                  <MetaRow entry={row} />
                </span>
              ),
            },
            {
              key: 'createdAt',
              header: 'When',
              render: (row: AuditEntry) => (
                <time
                  dateTime={row.createdAt}
                  title={new Date(row.createdAt).toLocaleString()}
                  className="whitespace-nowrap text-muted-foreground text-sm"
                >
                  {relativeTime(row.createdAt)}
                </time>
              ),
            },
          ]}
          rows={list.data?.data}
          rowKey={(row) => row.id}
          loading={list.isLoading}
          error={list.isError}
          onRetry={() => list.refetch()}
          meta={list.data?.meta}
          onPageChange={params.setPage}
          emptyTitle="Nothing recorded yet"
          emptyHint={
            hasFilters ? 'Try widening the filters' : 'Changes will appear here as they happen'
          }
        />
      </FadeInItem>
    </Stagger>
  );
}

export default function AuditPage() {
  return (
    <Suspense>
      <AuditView />
    </Suspense>
  );
}
