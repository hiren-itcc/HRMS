'use client';

import { Button } from '@hrms/ui/components/button';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErrorState } from '@/components/error-state';
import { formatMoney, formatMonth, payrollApi } from '@/features/payroll/api';
import { PaymentStatusBadge } from '@/features/payroll/components/status-badge';
import type { PayslipLine } from '@/features/payroll/types';

/**
 * The payslip document.
 *
 * Print is the delivery mechanism rather than a server-generated PDF: the
 * browser's own dialog produces a perfectly good file, and the payslip stays
 * inspectable rather than becoming an opaque binary.
 */
function LineTable({
  title,
  lines,
  total,
}: {
  title: string;
  lines: PayslipLine[];
  total: number;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="min-w-0 flex-1">
      <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
        {title}
      </h3>
      <dl className="space-y-1.5 text-sm">
        {lines.map((line) => (
          <div key={line.code} className="flex justify-between gap-4">
            <dt className="min-w-0 truncate">{line.name}</dt>
            <dd className="shrink-0 tabular-nums">{formatMoney(line.amount)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t pt-1.5 font-medium">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(total)}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const payslip = useQuery({ queryKey: ['payslip', id], queryFn: () => payrollApi.payslip(id) });

  if (payslip.isError) return <ErrorState onRetry={() => payslip.refetch()} />;
  if (!payslip.data) return <Skeleton className="h-96 w-full rounded-xl" />;
  const p = payslip.data;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/payroll" />}>
          <ArrowLeft className="size-4" aria-hidden /> Back
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> Print / save as PDF
        </Button>
      </div>

      <article className="rounded-xl border bg-card p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div>
            <h2 className="text-xl">Payslip — {formatMonth(p.month)}</h2>
            <p className="mt-0.5 text-muted-foreground text-sm">
              {p.structureName}
              {p.payDate && ` · paid on ${p.payDate}`}
            </p>
          </div>
          <PaymentStatusBadge status={p.payment.status} />
        </header>

        <dl className="grid gap-x-8 gap-y-2 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Employee', p.employee.name],
            ['Code', p.employee.code],
            ['Department', p.employee.department ?? '—'],
            ['Designation', p.employee.designation ?? '—'],
            ['Working days', String(p.days.working)],
            ['Loss of pay', String(p.days.lop)],
            ['Payable days', String(p.days.payable)],
            ['Bank', p.bank.name ? `${p.bank.name} ${p.bank.accountNumberMasked ?? ''}` : '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-6 border-t py-4 sm:flex-row sm:gap-10">
          <LineTable title="Earnings" lines={p.earnings} total={p.totals.gross} />
          <LineTable title="Deductions" lines={p.deductions} total={p.totals.deductions} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3">
          <span className="font-medium">Net pay</span>
          <span className="font-bold text-xl tabular-nums">{formatMoney(p.totals.net)}</span>
        </div>

        {p.totals.carriedShortfall > 0 && (
          <p className="mt-3 text-muted-foreground text-xs">
            {formatMoney(p.totals.carriedShortfall)} of deductions could not be taken this month and
            has been carried forward — net pay is never negative.
          </p>
        )}

        {p.employerContributions.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <LineTable
              title="Employer contributions (not deducted from your pay)"
              lines={p.employerContributions}
              total={p.totals.employerContribution}
            />
          </div>
        )}

        <p className="mt-6 text-muted-foreground text-xs">
          This is a computer-generated payslip and does not require a signature.
        </p>
      </article>
    </section>
  );
}
