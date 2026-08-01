'use client';

import { Button } from '@hrms/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hrms/ui/components/dropdown-menu';
import { Skeleton } from '@hrms/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hrms/ui/components/table';
import { Toggle } from '@hrms/ui/components/toggle';
import { ToggleGroup } from '@hrms/ui/components/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@hrms/ui/components/tooltip';
import { cn } from '@hrms/ui/lib/utils';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Rows2,
  Rows3,
} from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { useUiStore } from '@/stores/ui-store';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  /** e.g. "hidden md:table-cell" to drop low-priority columns on phones */
  className?: string;
  /**
   * Opt out of the column menu. Use for the column that identifies the row —
   * a table whose name column can be hidden is a table of anonymous rows.
   */
  alwaysVisible?: boolean;
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
  onSortChange?: (key: string) => void;
  meta?: { page: number; limit: number; total: number };
  onPageChange?: (page: number) => void;
  emptyTitle: string;
  emptyHint?: string;
  /** Rendered when the empty state should offer a way forward. */
  emptyAction?: React.ReactNode;
  /**
   * Without this a failed query rendered headers over an empty body, which
   * reads as "no results" rather than "this did not load".
   */
  error?: boolean;
  onRetry?: () => void;
  /** Right-aligned actions cell (edit/delete) — omitted for read-only viewers */
  actions?: (row: T) => React.ReactNode;
}

/** Page numbers around the current one, with gaps marked by null. */
function pageWindow(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const around = [page - 1, page, page + 1].filter((p) => p > 1 && p < count);
  const pages = [1, ...around, count];
  return pages.flatMap((p, i) => (i > 0 && p - pages[i - 1] > 1 ? [null, p] : [p]));
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  sort,
  order,
  onSortChange,
  meta,
  onPageChange,
  emptyTitle,
  emptyHint,
  emptyAction,
  error,
  onRetry,
  actions,
}: DataTableProps<T>) {
  const density = useUiStore((s) => s.density);
  const setDensity = useUiStore((s) => s.setDensity);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const hideable = columns.filter((col) => !col.alwaysVisible);
  const visible = columns.filter((col) => !hidden.has(col.key));
  const colCount = visible.length + (actions ? 1 : 0);
  const pageCount = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;
  const compact = density === 'compact';
  const cellPad = compact ? 'py-1.5' : 'py-3';

  const toggleColumn = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="space-y-3">
      {hideable.length > 1 && (
        <TooltipProvider delay={300}>
          <div className="flex items-center justify-end gap-1.5 print:hidden">
            <ToggleGroup
              value={[density]}
              // Behaves as a radio group: clicking the active option would
              // otherwise deselect it and leave neither density chosen.
              onValueChange={(value) => {
                if (value.length) setDensity(value[0] === 'compact' ? 'compact' : 'comfortable');
              }}
              aria-label="Row density"
              className="h-8"
            >
              {(
                [
                  ['comfortable', Rows2, 'Comfortable rows'],
                  ['compact', Rows3, 'Compact rows'],
                ] as const
              ).map(([value, Icon, label]) => (
                <Tooltip key={value}>
                  <TooltipTrigger
                    render={
                      <Toggle value={value} size="sm" aria-label={label}>
                        <Icon className="size-4" aria-hidden />
                      </Toggle>
                    }
                  />
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-8" />}>
                <Columns3 className="size-4" aria-hidden />
                <span className="hidden sm:inline">Columns</span>
                {hidden.size > 0 && (
                  <span className="tabular-nums text-muted-foreground">({visible.length})</span>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hideable.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={!hidden.has(col.key)}
                    onCheckedChange={() => toggleColumn(col.key)}
                  >
                    {col.header}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>
      )}

      {/* max-h + sticky header: long pages scroll the rows under the labels
          rather than scrolling the labels off the top. */}
      <div className="max-h-[70dvh] overflow-auto rounded-xl border bg-card shadow-xs print:max-h-none print:overflow-visible">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="border-b bg-muted/70 backdrop-blur-sm hover:bg-muted/70">
              {visible.map((col) => (
                <TableHead
                  key={col.key}
                  aria-sort={
                    col.sortable && sort === col.key
                      ? order === 'desc'
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                  className={cn('h-11 font-medium text-xs uppercase tracking-wider', col.className)}
                >
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      className="-mx-1.5 group inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                      onClick={() => onSortChange(col.key)}
                      aria-label={`Sort by ${col.header}`}
                    >
                      {col.header}
                      {sort === col.key ? (
                        order === 'desc' ? (
                          <ArrowDown className="size-3.5 text-foreground" aria-hidden />
                        ) : (
                          <ArrowUp className="size-3.5 text-foreground" aria-hidden />
                        )
                      ) : (
                        // Only on hover/focus: a permanent glyph on every
                        // sortable column is visual noise that says nothing.
                        <ChevronsUpDown
                          className="size-3.5 opacity-0 transition-opacity group-hover:opacity-50 group-focus-visible:opacity-50"
                          aria-hidden
                        />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
              {actions && (
                <TableHead className="w-24 text-right font-medium text-xs uppercase tracking-wider">
                  Actions
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 5 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders never reorder
                <TableRow key={i}>
                  {visible.map((col) => (
                    <TableCell key={col.key} className={cn(cellPad, col.className)}>
                      {/* Two bars: real rows carry a name over a secondary line,
                          so a single bar made every row jump ~20px on load. */}
                      <Skeleton className="h-3.5 w-28" />
                      {!compact && <Skeleton className="mt-1.5 h-2.5 w-16 opacity-60" />}
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell className={cn(cellPad, 'text-right')}>
                      <Skeleton className="ml-auto h-8 w-16" />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            {!loading && error && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount}>
                  <ErrorState onRetry={onRetry} />
                </TableCell>
              </TableRow>
            )}
            {!loading && !error && rows?.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount}>
                  <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              !error &&
              rows?.map((row) => (
                <TableRow key={rowKey(row)} className="transition-colors last:border-0">
                  {visible.map((col) => (
                    <TableCell key={col.key} className={cn(cellPad, col.className)}>
                      {col.render(row)}
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell className={cn(cellPad, 'text-right')}>
                      <div className="flex justify-end gap-1">{actions(row)}</div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {meta && (meta.total > 0 || meta.page > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p aria-live="polite" className="text-muted-foreground text-sm tabular-nums">
            {meta.total === 0
              ? 'No results'
              : `${(meta.page - 1) * meta.limit + 1}–${Math.min(meta.page * meta.limit, meta.total)} of ${meta.total}`}
          </p>
          <nav aria-label="Pagination" className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => onPageChange?.(meta.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" aria-hidden />
              <span className="hidden sm:inline">Prev</span>
            </Button>

            {/* Jumping straight to a page beats clicking Next eleven times. */}
            <div className="hidden items-center gap-1 sm:flex">
              {pageWindow(meta.page, pageCount).map((page, i) =>
                page === null ? (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: gaps have no identity of their own
                    key={`gap-${i}`}
                    aria-hidden
                    className="px-1 text-muted-foreground text-sm"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={page}
                    variant={page === meta.page ? 'default' : 'ghost'}
                    size="sm"
                    className="min-w-9 tabular-nums"
                    aria-label={`Page ${page}`}
                    aria-current={page === meta.page ? 'page' : undefined}
                    onClick={() => onPageChange?.(page)}
                  >
                    {page}
                  </Button>
                ),
              )}
            </div>
            <span className="text-sm tabular-nums sm:hidden">
              {meta.page} / {pageCount}
            </span>

            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= pageCount}
              onClick={() => onPageChange?.(meta.page + 1)}
              aria-label="Next page"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </nav>
        </div>
      )}
    </div>
  );
}
