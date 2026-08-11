'use client';

import { TICKET_STATUSES } from '@hrms/shared';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { IconAction } from '@/components/icon-action';
import { useSession } from '@/components/session-provider';
import { helpdeskApi, helpdeskKeys, type TicketListRequest } from '@/features/helpdesk/api';
import {
  TicketAgeBadge,
  TicketPriorityBadge,
  TicketStatusBadge,
} from '@/features/helpdesk/components/ticket-badges';
import type { Ticket } from '@/features/helpdesk/types';

/**
 * The desk.
 *
 * Oldest first, which is the whole reason this module has no SLA: a queue is
 * worked from the bottom, and "how long has this been sitting there" is the
 * question a due date would have answered less honestly. The API sorts it.
 *
 * "Everyone's tickets" appears only for `helpdesk.read`. Working the desk gets
 * you your queue — yours plus unassigned — and reading somebody else's is a
 * different grant on purpose.
 */
export default function QueuePage() {
  const { can } = useSession();
  const [everyone, setEveryone] = useState(false);
  const [status, setStatus] = useState<Ticket['status'] | ''>('');

  const params: TicketListRequest = {
    page: 1,
    limit: 50,
    scope: everyone && can('helpdesk.read') ? 'all' : 'queue',
    ...(status ? { status } : {}),
  };
  const query = useQuery({
    queryKey: helpdeskKeys.tickets(params),
    queryFn: () => helpdeskApi.list(params),
  });

  const columns: Column<Ticket>[] = [
    {
      key: 'subject',
      header: 'Subject',
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/helpdesk/${row.id}`} className="font-medium hover:underline">
          {row.subject}
        </Link>
      ),
    },
    { key: 'requester', header: 'Raised by', render: (row) => row.requester?.name ?? '—' },
    { key: 'category', header: 'Desk', render: (row) => row.category?.name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      alwaysVisible: true,
      /* The desk's wording: "Waiting on requester", not "Waiting on you". */
      render: (row) => <TicketStatusBadge status={row.status} audience="agent" />,
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (row) => <TicketPriorityBadge priority={row.priority} />,
    },
    {
      key: 'assignee',
      header: 'With',
      render: (row) =>
        row.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>,
    },
    { key: 'age', header: 'Waiting', render: (row) => <TicketAgeBadge days={row.ageDays} /> },
    {
      key: 'actions',
      header: '',
      alwaysVisible: true,
      render: (row) => (
        <IconAction
          icon={Eye}
          label="Open this ticket"
          render={<Link href={`/helpdesk/${row.id}`} />}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as Ticket['status'] | '')}
          aria-label="Filter by status"
        >
          <option value="">Every status</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>

        {can('helpdesk.read') && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={everyone}
              onChange={(e) => setEveryone(e.target.checked)}
            />
            Everyone’s tickets, not just my queue
          </label>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="Nothing waiting"
        emptyHint="Tickets assigned to you, and any nobody has picked up yet, appear here."
      />
    </div>
  );
}
