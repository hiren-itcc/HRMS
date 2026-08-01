'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state';
import { leaveApi } from '@/features/leave/api';
import { LeaveRequestRow } from '@/features/leave/components/request-row';
import { useListParams } from '@/hooks/use-list-params';
import { ApiError } from '@/lib/api-client';

function LeaveApprovalsView() {
  const queryClient = useQueryClient();
  const params = useListParams('startDate');
  const reduceMotion = useReducedMotion();
  const status = params.get('status') ?? 'PENDING';
  const [notes, setNotes] = useState<Record<string, string>>({});

  const requests = useQuery({
    queryKey: ['leave', 'requests', 'inbox', status, params.page],
    queryFn: () => leaveApi.requests({ scope: 'inbox', status, page: params.page, limit: 10 }),
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      action === 'approve'
        ? leaveApi.approve(id, { note: notes[id] })
        : leaveApi.reject(id, { note: notes[id] }),
    onSuccess: (_d, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['leave'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success(action === 'approve' ? 'Leave approved' : 'Leave rejected');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not record the decision'),
  });

  const rows = requests.data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Leave approvals</CardTitle>
            <CardDescription>
              Approving books the days against the employee's balance
            </CardDescription>
          </div>
          <Select value={status} onValueChange={(v) => params.setFilter('status', v)}>
            <SelectTrigger className="w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.isLoading && <Skeleton className="h-32 w-full rounded-xl" />}

        {!requests.isLoading && rows.length === 0 && (
          <EmptyState
            title="Nothing to review"
            hint={status === 'PENDING' ? 'All caught up.' : 'No requests with this status.'}
          />
        )}

        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.id}
              layout={!reduceMotion}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              <LeaveRequestRow
                request={r}
                showEmployee
                actions={
                  r.status === 'PENDING' ? (
                    <>
                      <Input
                        placeholder="Note (optional)"
                        value={notes[r.id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                        className="max-w-xs flex-1"
                        aria-label={`Decision note for ${r.employee?.firstName}`}
                      />
                      <Button
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, action: 'approve' })}
                      >
                        <Check className="size-4" aria-hidden /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, action: 'reject' })}
                      >
                        <X className="size-4" aria-hidden /> Reject
                      </Button>
                    </>
                  ) : undefined
                }
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {requests.data && requests.data.meta.total > requests.data.meta.limit && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-muted-foreground text-sm tabular-nums">
              {requests.data.meta.total} requests
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={params.page <= 1}
                onClick={() => params.setPage(params.page - 1)}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={params.page * requests.data.meta.limit >= requests.data.meta.total}
                onClick={() => params.setPage(params.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LeaveApprovalsPage() {
  return (
    <Suspense>
      <LeaveApprovalsView />
    </Suspense>
  );
}
