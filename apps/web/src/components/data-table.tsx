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
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

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
  actions,
}: DataTableProps<T>) {
  const colCount = columns.length + (actions ? 1 : 0);
  const pageCount = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      className="-ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 font-medium hover:text-foreground focus-visible:outline-2"
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
                  {Array.from({ length: colCount }, (_, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders never reorder
                    <TableCell key={j} className={columns[j]?.className}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading && rows?.length === 0 && (
              <TableRow>
                <TableCell colSpan={colCount} className="h-40">
                  <div className="flex flex-col items-center justify-center gap-1 text-center">
                    <Inbox className="size-8 text-muted-foreground/50" aria-hidden />
                    <p className="font-medium text-sm">{emptyTitle}</p>
                    {emptyHint && <p className="text-muted-foreground text-xs">{emptyHint}</p>}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              rows?.map((row) => (
                <TableRow key={rowKey(row)}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
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

      {meta && meta.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm tabular-nums">
            {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of{' '}
            {meta.total}
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
