'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { FileText, TrendingUp, Wallet } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { StatCard } from '@/components/stat-card';
import { formatMoney, formatMonth, payrollApi, payrollKeys } from '@/features/payroll/api';
import { PaymentStatusBadge } from '@/features/payroll/components/status-badge';

/** Employee self-service: own salary, own revision history, own payslips. */
export default function MySalaryPage() {
  const salary = useQuery({
    queryKey: [...payrollKeys.salaries(), 'me'],
    queryFn: payrollApi.mySalary,
  });
  const payslips = useQuery({
    queryKey: [...payrollKeys.payslips(), 'me'],
    queryFn: () => payrollApi.myPayslips({ limit: 24 }),
  });

  if (salary.isError) return <ErrorState onRetry={() => salary.refetch()} />;
  if (!salary.data) return <Skeleton className="h-64 w-full rounded-xl" />;

  const { current, revisions, employee } = salary.data;

  return (
    <section className="space-y-5">
      {current ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
          <StatCard
            label="Monthly CTC"
            value={formatMoney(current.monthlyCtc)}
            hint={current.structureName}
            icon={Wallet}
            gradient="primary"
          />
          <StatCard
            label="Effective from"
            value={current.effectiveFrom ?? '—'}
            hint={current.revisionType.toLowerCase()}
            icon={TrendingUp}
            gradient="emerald"
          />
          <StatCard
            label="Payslips"
            value={payslips.data?.meta.total ?? 0}
            hint="Published to you"
            icon={FileText}
            gradient="sky"
          />
        </div>
      ) : (
        <EmptyState
          icon={Wallet}
          title="No salary has been assigned yet"
          hint="Your HR team will set this up. Payslips appear here once payroll is published."
        />
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Salary history</CardTitle>
            <CardDescription>Every revision since you joined</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {revisions.length === 0 && (
              <p className="py-6 text-center text-muted-foreground text-sm">Nothing to show yet.</p>
            )}
            {revisions.map((revision) => (
              <div key={revision.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{formatMoney(revision.monthlyCtc)}</span>
                  {revision.changePercent !== null && (
                    <span
                      className={
                        revision.changePercent >= 0
                          ? 'font-medium text-success-text text-sm'
                          : 'font-medium text-destructive-text text-sm'
                      }
                    >
                      {revision.changePercent >= 0 ? '+' : ''}
                      {revision.changePercent}%
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {revision.effectiveFrom} · {revision.revisionType.toLowerCase()}
                  {revision.reason && ` · ${revision.reason}`}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My payslips</CardTitle>
            <CardDescription>Published payslips only</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {payslips.isLoading && <Skeleton className="h-24 w-full rounded-xl" />}
            {payslips.data?.data.length === 0 && (
              <p className="py-6 text-center text-muted-foreground text-sm">
                No payslips have been published yet.
              </p>
            )}
            {payslips.data?.data.map((slip) => (
              <Link
                key={slip.id}
                href={`/payroll/payslips/${slip.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm">{formatMonth(slip.month)}</p>
                  <p className="text-muted-foreground text-xs">
                    {slip.payableDays} payable days
                    {slip.lopDays > 0 && ` · ${slip.lopDays} LOP`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-medium tabular-nums">{formatMoney(slip.netPay)}</span>
                  <PaymentStatusBadge status={slip.paymentStatus} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {employee.bank && (
        <p className="text-muted-foreground text-xs">
          Salary is paid to {employee.bank.bankName} {employee.bank.accountNumberMasked}. Contact HR
          to change your bank details.
        </p>
      )}
    </section>
  );
}
