'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Inbox } from 'lucide-react';
import { useState } from 'react';
import { FadeInItem, Stagger } from '@/components/motion';
import { leaveApi } from '@/features/leave/api';
import { ApplyLeaveDialog } from '@/features/leave/components/apply-dialog';
import { BalanceCard } from '@/features/leave/components/balance-card';
import { LeaveRequestRow } from '@/features/leave/components/request-row';
import { useApiMutation } from '@/hooks/use-crud';

const ALL = 'all';

export default function MyLeavePage() {
  const _queryClient = useQueryClient();
  const [applyOpen, setApplyOpen] = useState(false);
  const [status, setStatus] = useState<string>(ALL);

  const balances = useQuery({
    queryKey: ['leave', 'balances', 'me'],
    queryFn: () => leaveApi.myBalances(),
    retry: false,
  });

  const requests = useQuery({
    queryKey: ['leave', 'requests', 'own', status],
    queryFn: () =>
      leaveApi.requests({ scope: 'own', limit: 20, status: status === ALL ? undefined : status }),
    retry: false,
  });

  const cancel = useApiMutation({
    mutationFn: leaveApi.cancel,
    invalidate: [['leave'], ['attendance']],
    success: 'Leave request cancelled',
    error: 'Could not cancel the request',
  });

  const rows = requests.data?.data ?? [];
  const hasEmployeeRecord = (balances.data?.balances.length ?? 0) > 0 || !balances.isError;

  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>My balances {balances.data ? `· ${balances.data.year}` : ''}</CardTitle>
                <CardDescription>
                  Weekends and holidays are never deducted from your balance
                </CardDescription>
              </div>
              <Button onClick={() => setApplyOpen(true)} disabled={!hasEmployeeRecord}>
                <CalendarPlus className="size-4" aria-hidden /> Apply for leave
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {balances.isLoading && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-2xl" />
                ))}
              </div>
            )}
            {balances.data?.balances.length === 0 && (
              <p className="py-6 text-center text-muted-foreground text-sm">
                No leave types configured yet.
              </p>
            )}
            {balances.isError && (
              <p className="py-6 text-center text-muted-foreground text-sm">
                No employee record is linked to this account, so there is no leave balance.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {balances.data?.balances.map((b, i) => (
                <BalanceCard key={b.id} balance={b} index={i} />
              ))}
            </div>
          </CardContent>
        </Card>
      </FadeInItem>

      <FadeInItem>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>My requests</CardTitle>
                <CardDescription>Your leave history and pending applications</CardDescription>
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {requests.isLoading && <Skeleton className="h-28 w-full rounded-xl" />}
            {!requests.isLoading && rows.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Inbox className="size-8 text-muted-foreground/50" aria-hidden />
                <p className="font-medium text-sm">No leave requests</p>
                <p className="text-muted-foreground text-xs">
                  Apply for leave and it will show up here.
                </p>
              </div>
            )}
            {rows.map((r) => (
              <LeaveRequestRow
                key={r.id}
                request={r}
                onCancel={
                  r.status === 'PENDING' || r.status === 'APPROVED'
                    ? () => cancel.mutate(r.id)
                    : undefined
                }
                cancelling={cancel.isPending}
              />
            ))}
          </CardContent>
        </Card>
      </FadeInItem>

      <ApplyLeaveDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        balances={balances.data?.balances ?? []}
      />
    </Stagger>
  );
}
