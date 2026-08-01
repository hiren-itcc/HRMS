'use client';

import { Button } from '@hrms/ui/components/button';
import { cn } from '@hrms/ui/lib/utils';
import { CalendarRange } from 'lucide-react';
import { formatDays, formatRange, type LeaveRequest } from '../api';

const STATUS: Record<string, string> = {
  PENDING: 'bg-warning/15 text-warning-text',
  APPROVED: 'bg-success/15 text-success-text',
  REJECTED: 'bg-destructive/15 text-destructive-text',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export function LeaveStatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 font-medium text-xs',
        STATUS[status] ?? STATUS.CANCELLED,
      )}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

interface RequestRowProps {
  request: LeaveRequest;
  /** Show whose leave it is (team/approval views). */
  showEmployee?: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
  actions?: React.ReactNode;
}

export function LeaveRequestRow({
  request,
  showEmployee,
  onCancel,
  cancelling,
  actions,
}: RequestRowProps) {
  const half = request.halfDaySide
    ? request.halfDaySide === 'FIRST_HALF'
      ? ' · first half'
      : ' · second half'
    : '';

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showEmployee && request.employee && (
            <p className="font-medium text-sm">
              {request.employee.firstName} {request.employee.lastName}{' '}
              <span className="font-mono text-muted-foreground text-xs">
                {request.employee.employeeCode}
              </span>
            </p>
          )}
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium tabular-nums">
              {formatRange(request.startDate, request.endDate)}
            </span>
            <span className="text-muted-foreground">
              · {formatDays(request.days)}
              {half} · {request.leaveType?.name}
            </span>
          </p>
        </div>
        <LeaveStatusChip status={request.status} />
      </div>

      <p className="rounded-lg bg-muted/50 p-2.5 text-sm">{request.reason}</p>
      {request.approverNote && (
        <p className="text-muted-foreground text-xs">Reviewer: {request.approverNote}</p>
      )}

      {(actions || onCancel) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {onCancel && (
            <Button variant="ghost" size="sm" disabled={cancelling} onClick={onCancel}>
              Cancel request
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
