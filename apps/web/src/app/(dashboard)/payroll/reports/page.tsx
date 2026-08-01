'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hrms/ui/components/table';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { formatMoney, formatMonth, payrollApi, payrollKeys } from '@/features/payroll/api';
import { PayrollExport } from '@/features/payroll/components/payroll-export';

const REPORTS = [
  ['register', 'Salary register'],
  ['bank-transfer', 'Bank transfer'],
  ['pf', 'PF contributions'],
  ['esi', 'ESI contributions'],
  ['tax', 'Tax deductions'],
  ['department', 'Department payroll'],
] as const;

export default function PayrollReportsPage() {
  const runs = useQuery({
    queryKey: payrollKeys.runs(),
    queryFn: () => payrollApi.runs({ limit: 24 }),
  });
  const [kind, setKind] = useState<string>('register');
  const [month, setMonth] = useState<string>('');

  const selectedMonth = month || runs.data?.data[0]?.month || '';

  const report = useQuery({
    queryKey: [...payrollKeys.reports(), kind, selectedMonth],
    queryFn: () => payrollApi.report(kind, { month: selectedMonth }),
    enabled: Boolean(selectedMonth),
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2>Payroll reports</h2>
          <p className="mt-0.5 text-muted-foreground text-sm">
            Built from the payslips of a run, so a report can never disagree with a payslip
          </p>
        </div>
        {report.data && (
          <PayrollExport
            kind={kind}
            month={selectedMonth}
            disabled={report.data.rows.length === 0}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2 print:hidden">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-56" aria-label="Report">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORTS.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedMonth} onValueChange={setMonth}>
          <SelectTrigger className="w-48" aria-label="Month">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {runs.data?.data.map((run) => (
              <SelectItem key={run.id} value={run.month}>
                {formatMonth(run.month)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {report.isLoading && <Skeleton className="h-64 w-full rounded-xl" />}
      {report.isError && <ErrorState onRetry={() => report.refetch()} />}
      {report.data && report.data.rows.length === 0 && (
        <EmptyState
          title="Nothing to report"
          hint="No payslip in this month contributes to this report."
        />
      )}

      {report.data && report.data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/70">
                {report.data.columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className={
                      column.type === 'number'
                        ? 'text-right font-medium text-xs uppercase tracking-wider'
                        : 'font-medium text-xs uppercase tracking-wider'
                    }
                  >
                    {column.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: report rows have no stable id
                <TableRow key={index}>
                  {report.data?.columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={column.type === 'number' ? 'text-right tabular-nums' : ''}
                    >
                      {column.type === 'number'
                        ? formatMoney(Number(row[column.key] ?? 0))
                        : (row[column.key] ?? '—')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="border-t-2 bg-muted/40 font-medium">
                {report.data.columns.map((column, index) => (
                  <TableCell
                    key={column.key}
                    className={column.type === 'number' ? 'text-right tabular-nums' : ''}
                  >
                    {index === 0
                      ? 'Total'
                      : column.type === 'number' && report.data?.totals[column.key] !== undefined
                        ? formatMoney(report.data.totals[column.key] as number)
                        : ''}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
