'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Separator } from '@hrms/ui/components/separator';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Paperclip, Pencil, Send, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/error-state';
import { useSession } from '@/components/session-provider';
import { documentsApi } from '@/features/documents/api';
import { expenseKeys, expensesApi } from '@/features/expenses/api';
import { ClaimFormDialog } from '@/features/expenses/components/claim-form';
import {
  ClaimStatusBadge,
  PaidBadge,
  ScheduledBadge,
} from '@/features/expenses/components/expense-badges';
import { formatMoney } from '@/features/payroll/api';
import { useApiMutation } from '@/hooks/use-crud';

export default function ExpenseClaimPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);

  const query = useQuery({ queryKey: expenseKeys.one(id), queryFn: () => expensesApi.get(id) });

  const viewReceipt = async (receiptId: string) => {
    try {
      const blob = await documentsApi.fileBlob(receiptId);
      const href = URL.createObjectURL(blob);
      window.open(href, '_blank', 'noopener');
      // Long enough for the tab to load; object URLs die with the page anyway.
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch {
      toast.error('Could not open the receipt');
    }
  };

  const submit = useApiMutation({
    mutationFn: () => expensesApi.submit(id),
    invalidate: [expenseKeys.all()],
    success: 'Claim submitted',
  });

  const withdraw = useApiMutation({
    mutationFn: () => expensesApi.withdraw(id),
    invalidate: [expenseKeys.all()],
    success: 'Claim withdrawn',
  });

  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (!query.data) return <Skeleton className="h-96 w-full rounded-xl" />;

  const claim = query.data;
  const isMine = claim.employeeId === user?.employee?.id;
  const isDraft = claim.status === 'DRAFT';

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/expenses" />}>
        <ArrowLeft className="size-4" aria-hidden /> Expenses
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-2">
            {claim.title}
            <ClaimStatusBadge status={claim.status} />
            {claim.paid && <PaidBadge month={claim.payrollMonth} />}
            {claim.status === 'APPROVED' && !claim.paid && claim.payrollMonth && (
              <ScheduledBadge month={claim.payrollMonth} />
            )}
          </h1>
          <p className="text-muted-foreground text-sm">
            {claim.employee ? `${claim.employee.firstName} ${claim.employee.lastName} · ` : ''}
            {formatMoney(claim.total)} across {claim.itemCount} line(s)
          </p>
        </div>

        {isMine && (
          <div className="flex flex-wrap gap-2">
            {isDraft && (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" aria-hidden /> Edit
                </Button>
                <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
                  <Send className="size-4" aria-hidden /> Submit for approval
                </Button>
              </>
            )}
            {/* Withdrawing is not deleting: an approver may already have read
                it, and a row that vanishes from an inbox is how two people end
                up disagreeing about whether a claim existed. */}
            {(isDraft || claim.status === 'SUBMITTED') && (
              <Button
                variant="ghost"
                disabled={withdraw.isPending}
                onClick={() => withdraw.mutate()}
              >
                <Undo2 className="size-4" aria-hidden /> Withdraw
              </Button>
            )}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {claim.items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{item.description}</p>
                <p className="text-muted-foreground text-xs">
                  {item.spentOn} · {item.category?.name ?? '—'}
                  {item.receiptId && (
                    <>
                      {' · '}
                      {/*
                       * Fetched with the api client rather than linked to the
                       * documents screen: an approver (Finance, a manager) can
                       * open the receipt through the claim, but has no access
                       * to the claimant's documents page.
                       */}
                      <button
                        type="button"
                        onClick={() => viewReceipt(item.receiptId as string)}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Paperclip className="size-3" aria-hidden /> Receipt
                      </button>
                    </>
                  )}
                </p>
              </div>
              <span className="shrink-0 tabular-nums">{formatMoney(item.amount)}</span>
            </div>
          ))}

          <Separator />
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(claim.total)}</span>
          </div>
        </CardContent>
      </Card>

      {(claim.decidedAt || claim.decisionNote) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <ClaimStatusBadge status={claim.status} />
              {claim.payrollMonth && (
                <Badge variant="outline">Paid with {claim.payrollMonth}</Badge>
              )}
            </p>
            {claim.decisionNote && <p className="text-muted-foreground">{claim.decisionNote}</p>}
          </CardContent>
        </Card>
      )}

      {isMine && isDraft && (
        <ClaimFormDialog
          claimId={claim.id}
          open={editing}
          onOpenChange={setEditing}
          initial={{
            title: claim.title,
            items: claim.items.map((item) => ({
              categoryId: item.categoryId,
              spentOn: item.spentOn,
              amount: item.amount,
              description: item.description,
              receiptId: item.receiptId,
            })),
          }}
        />
      )}
    </div>
  );
}
