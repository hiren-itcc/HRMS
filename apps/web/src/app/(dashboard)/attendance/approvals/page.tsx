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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { Suspense, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { attendanceApi, timeIn } from '@/features/attendance/api';
import { RequestStatusChip } from '@/features/attendance/components/request-status-chip';
import { useApiMutation } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));

function ApprovalsView() {
  const _queryClient = useQueryClient();
  const params = useListParams('date');
  const reduceMotion = useReducedMotion();
  const status = params.get('status') ?? 'PENDING';
  const [notes, setNotes] = useState<Record<string, string>>({});

  const requests = useQuery({
    queryKey: ['attendance', 'requests', 'inbox', status, params.page],
    queryFn: () => attendanceApi.requests({ scope: 'inbox', status, page: params.page, limit: 10 }),
  });

  const decide = useApiMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      action === 'approve'
        ? attendanceApi.approve(id, { note: notes[id] })
        : attendanceApi.reject(id, { note: notes[id] }),
    invalidate: [['attendance']],
    success: (_data, { action }) =>
      action === 'approve' ? 'Correction approved' : 'Request rejected',
    error: 'Could not record the decision',
  });

  const rows = requests.data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Correction approvals</CardTitle>
            <CardDescription>
              Approving writes the corrected times straight onto the timesheet
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
        {requests.isLoading && <Skeleton className="h-28 w-full rounded-xl" />}

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
              className="space-y-3 rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    {r.employee.firstName} {r.employee.lastName}{' '}
                    <span className="font-mono text-muted-foreground text-xs">
                      {r.employee.employeeCode}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-sm tabular-nums">
                    {dayLabel(r.date)} · requested in {timeIn(r.requestedIn)} · out{' '}
                    {timeIn(r.requestedOut)}
                  </p>
                </div>
                <RequestStatusChip status={r.status} />
              </div>

              <p className="rounded-lg bg-muted/50 p-2.5 text-sm">{r.reason}</p>

              {r.status === 'PENDING' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Note (optional)"
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    className="max-w-xs flex-1"
                    aria-label={`Decision note for ${r.employee.firstName}`}
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
                </div>
              ) : (
                r.approverNote && (
                  <p className="text-muted-foreground text-xs">Note: {r.approverNote}</p>
                )
              )}
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

export default function ApprovalsPage() {
  return (
    <Suspense>
      <ApprovalsView />
    </Suspense>
  );
}
