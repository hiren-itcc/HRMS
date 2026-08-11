'use client';

import { TICKET_STATUSES } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Eye, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { IconAction } from '@/components/icon-action';
import { helpdeskApi, helpdeskKeys, type TicketListRequest } from '@/features/helpdesk/api';
import {
  TicketAgeBadge,
  TicketPriorityBadge,
  TicketStatusBadge,
} from '@/features/helpdesk/components/ticket-badges';
import { TicketFormDialog } from '@/features/helpdesk/components/ticket-form';
import type { Ticket } from '@/features/helpdesk/types';

export default function MyTicketsPage() {
  const [raising, setRaising] = useState(false);
  const [status, setStatus] = useState<Ticket['status'] | ''>('');

  const params: TicketListRequest = {
    page: 1,
    limit: 50,
    order: 'desc',
    scope: 'own',
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
    { key: 'category', header: 'Desk', render: (row) => row.category?.name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      alwaysVisible: true,
      /* The requester's wording: "Waiting on you" means them. */
      render: (row) => <TicketStatusBadge status={row.status} />,
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (row) => <TicketPriorityBadge priority={row.priority} />,
    },
    {
      key: 'assignee',
      header: 'With',
      render: (row) => row.assignee?.name ?? 'Not picked up yet',
    },
    { key: 'age', header: 'Age', render: (row) => <TicketAgeBadge days={row.ageDays} /> },
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
      <div className="flex flex-wrap items-center justify-between gap-2">
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

        <Button onClick={() => setRaising(true)}>
          <Plus className="size-4" aria-hidden /> Raise a ticket
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="You have not asked us anything yet"
        emptyHint="Raise a ticket and it goes to the desk that handles it. You will get an email when somebody replies."
      />

      <TicketFormDialog open={raising} onOpenChange={setRaising} />
    </div>
  );
}
