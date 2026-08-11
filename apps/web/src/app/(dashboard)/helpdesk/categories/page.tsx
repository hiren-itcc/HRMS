'use client';

import { type TicketCategoryCreateInput, ticketCategoryCreateSchema } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { SelectItem } from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { type Column, DataTable } from '@/components/data-table';
import { FormInput, FormSelect, FormSwitch } from '@/components/form';
import { IconAction } from '@/components/icon-action';
import { employeesApi } from '@/features/employees/api';
import { helpdeskApi, helpdeskKeys } from '@/features/helpdesk/api';
import type { TicketCategory } from '@/features/helpdesk/types';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

/**
 * The desks, and who picks each one up.
 *
 * `defaultAssignee` is the whole routing engine — no rules, no round-robin, no
 * load balancing. One named person per desk is enough for one desk, and the API
 * refuses anybody who does not hold `helpdesk.respond`, because a category
 * routing to somebody who cannot act on it produces a queue of silently dead
 * tickets nobody notices for a week.
 *
 * A desk with tickets against it is **deactivated, not deleted** — the history
 * has to stay readable, and the API and the foreign key both refuse.
 */
export default function HelpdeskCategoriesPage() {
  const [editing, setEditing] = useState<TicketCategory | null>(null);
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: helpdeskKeys.categories(),
    queryFn: () => helpdeskApi.listCategories(),
  });

  const columns: Column<TicketCategory>[] = [
    { key: 'name', header: 'Desk', alwaysVisible: true, render: (row) => row.name },
    { key: 'description', header: 'What it covers', render: (row) => row.description ?? '—' },
    {
      key: 'assignee',
      header: 'Picked up by',
      render: (row) =>
        row.defaultAssignee?.name ?? (
          <span className="text-muted-foreground">Whoever is on the desk</span>
        ),
    },
    {
      key: 'tickets',
      header: 'Tickets',
      render: (row) => <span className="tabular-nums">{row.ticketCount ?? 0}</span>,
    },
    {
      key: 'active',
      header: 'Status',
      alwaysVisible: true,
      render: (row) =>
        row.active ? (
          <Badge variant="outline">Open for new tickets</Badge>
        ) : (
          <Badge className="border-transparent bg-muted text-muted-foreground">Closed</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      alwaysVisible: true,
      render: (row) => (
        <IconAction icon={Pencil} label={`Edit ${row.name}`} onClick={() => setEditing(row)} />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /> Add a desk
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={query.data}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="No desks yet"
        emptyHint="A desk is what a ticket is raised against — Payroll query, IT support. Add one and people can start asking."
      />

      <CategoryDialog
        key={editing?.id ?? 'new'}
        category={editing}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
    </div>
  );
}

function CategoryDialog({
  category,
  open,
  onOpenChange,
}: {
  category: TicketCategory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const form = useZodForm<TicketCategoryCreateInput>(ticketCategoryCreateSchema, {
    defaultValues: {
      name: category?.name ?? '',
      description: category?.description ?? '',
      defaultAssigneeId: category?.defaultAssignee?.id ?? '',
      active: category?.active ?? true,
    },
  });

  /* Everybody, because the API is what decides who may actually be assigned —
     it refuses anybody without `helpdesk.respond` and says so. Filtering the
     list here would need the permission graph on the client. */
  const people = useQuery({
    queryKey: ['employees', 'options', 'helpdesk'],
    queryFn: () => employeesApi.list({ page: 1, limit: 200, status: 'ACTIVE' }),
    enabled: open,
  });

  const save = useApiMutation({
    mutationFn: (values: TicketCategoryCreateInput) => {
      const input = { ...values, defaultAssigneeId: values.defaultAssigneeId || null };
      return category
        ? helpdeskApi.updateCategory(category.id, input)
        : helpdeskApi.createCategory(input);
    },
    invalidate: [helpdeskKeys.all()],
    success: 'Desk saved',
    onSuccess: () => onOpenChange(false),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={category ? 'Edit the desk' : 'Add a desk'}
      submitting={save.isPending}
      submitLabel="Save"
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
      <FormInput
        control={form.control}
        name="name"
        label="Name"
        placeholder="Payroll query"
        required
      />
      <FormInput
        control={form.control}
        name="description"
        label="What it covers"
        placeholder="Payslips, reimbursements, tax and bank details"
      />
      <FormSelect
        control={form.control}
        name="defaultAssigneeId"
        label="Picked up by"
        placeholder="Whoever is on the desk"
        hint="They must hold helpdesk.respond — a desk that routes to somebody who cannot answer goes quiet without anybody noticing."
      >
        {(people.data?.data ?? []).map((person) => (
          <SelectItem key={person.id} value={person.id}>
            {person.firstName} {person.lastName}
          </SelectItem>
        ))}
      </FormSelect>
      <FormSwitch
        control={form.control}
        name="active"
        label="Open for new tickets"
        hint="Turn this off instead of deleting — the tickets already raised against it stay readable."
      />
    </FormDialog>
  );
}
