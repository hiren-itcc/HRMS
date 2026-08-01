'use client';

import { Button } from '@hrms/ui/components/button';
import { Skeleton } from '@hrms/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hrms/ui/components/table';
import { cn } from '@hrms/ui/lib/utils';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  /** e.g. "hidden md:table-cell" to drop low-priority columns on phones */
  className?: string;
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
  const colCount = columns.length + (actions ? 1 : 0);
  const pageCount = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  aria-sort={
                    col.sortable && sort === col.key
                      ? order === 'desc'
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                  className={cn('h-11', col.className)}
                >
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      className="-ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 font-medium uppercase tracking-wider hover:text-foreground focus-visible:outline-2"
                      onClick={() => onSortChange(col.key)}
                      aria-label={`Sort by ${col.header}`}
                    >
                      {col.header}
                      {sort === col.key ? (
                        order === 'desc' ? (
                          <ArrowDown className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowUp className="size-3.5" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
              {actions && <TableHead className="w-24 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 5 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders never reorder
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={cn('py-3', col.className)}>
                      {/* Two bars: real rows carry a name over a secondary line,
                          so a single bar made every row jump ~20px on load. */}
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="mt-1.5 h-2.5 w-16 opacity-60" />
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell className="text-right">
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
                <TableRow
                  key={rowKey(row)}
                  className="transition-colors last:border-0 hover:bg-accent/40"
                >
                  {columns.map((col) => (
                    <TableCell key={col.key} className={cn('py-3', col.className)}>
                      {col.render(row)}
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">{actions(row)}</div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {meta && (meta.total > 0 || meta.page > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-muted-foreground text-sm tabular-nums">
            {meta.total === 0
              ? 'No results'
              : `${(meta.page - 1) * meta.limit + 1}–${Math.min(meta.page * meta.limit, meta.total)} of ${meta.total}`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => onPageChange?.(meta.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" aria-hidden /> Prev
            </Button>
            <span className={cn('text-sm tabular-nums')}>
              {meta.page} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= pageCount}
              onClick={() => onPageChange?.(meta.page + 1)}
              aria-label="Next page"
            >
              Next <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
