'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { shiftCreateSchema } from '@hrms/shared';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { CrudShell } from '@/components/crud/crud-shell';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { DataTable } from '@/components/data-table';
import { FormInput, FormTimePicker } from '@/components/form';
import { shiftsApi } from '@/features/organization/api';
import type { Shift } from '@/features/organization/types';
import { useCrudList, useCrudMutations } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const KEY = 'org-shifts';
type FormValues = z.input<typeof shiftCreateSchema>;

function ShiftsView() {
  const params = useListParams('name');
  const list = useCrudList(KEY, shiftsApi, {
    page: params.page,
    limit: 10,
    search: params.search,
    sort: params.sort,
    order: params.order,
  });
  const { create, update, remove } = useCrudMutations(KEY, shiftsApi, 'Shift');

  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(shiftCreateSchema) });

  const openNew = () => {
    form.reset({ name: '', startTime: '09:00', endTime: '18:00', graceMinutes: 15 });
    setEditing('new');
  };
  const openEdit = (row: Shift) => {
    form.reset({
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      graceMinutes: row.graceMinutes,
    });
    setEditing(row);
  };

  const submit = form.handleSubmit(async (raw) => {
    const input = shiftCreateSchema.parse(raw);
    if (editing === 'new') await create.mutateAsync(input);
    else if (editing) await update.mutateAsync({ id: editing.id, input });
    setEditing(null);
  });

  return (
    <CrudShell
      title="Shifts"
      description="Working-hour patterns assigned to employees"
      search={params.search}
      onSearchChange={params.setSearch}
      onAdd={openNew}
      addLabel="Add shift"
    >
      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            sortable: true,
            render: (s) => <span className="font-medium">{s.name}</span>,
          },
          {
            key: 'startTime',
            header: 'Start',
            sortable: true,
            render: (s) => <span className="tabular-nums">{s.startTime}</span>,
          },
          {
            key: 'endTime',
            header: 'End',
            sortable: true,
            render: (s) => <span className="tabular-nums">{s.endTime}</span>,
          },
          {
            key: 'grace',
            header: 'Grace',
            className: 'hidden sm:table-cell',
            render: (s) => <span className="tabular-nums">{s.graceMinutes} min</span>,
          },
          {
            key: 'employees',
            header: 'Employees',
            className: 'hidden md:table-cell',
            render: (s) => (
              <span className="text-muted-foreground tabular-nums">{s._count.employees}</span>
            ),
          },
        ]}
        rows={list.data?.data}
        rowKey={(s) => s.id}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => list.refetch()}
        sort={params.sort}
        order={params.order}
        onSortChange={params.toggleSort}
        meta={list.data?.meta}
        onPageChange={params.setPage}
        emptyTitle="No shifts yet"
        emptyHint="e.g. General 09:00–18:00"
        actions={(s) => (
          <RowActions
            name={s.name}
            onEdit={() => openEdit(s)}
            onDelete={() => remove.mutate(s.id)}
            deleting={remove.isPending}
          />
        )}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'Add shift' : 'Edit shift'}
        onSubmit={submit}
        submitting={create.isPending || update.isPending}
        submitLabel={editing === 'new' ? 'Create' : 'Save'}
      >
        <FormInput control={form.control} name="name" label="Name" autoFocus />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormTimePicker control={form.control} name="startTime" label="Start time" />
          <FormTimePicker control={form.control} name="endTime" label="End time" />
        </div>
        <FormInput
          control={form.control}
          name="graceMinutes"
          label="Grace period (minutes)"
          hint="Late arrivals within this window aren't flagged"
          type="number"
          min={0}
          max={240}
        />
      </FormDialog>
    </CrudShell>
  );
}

export default function ShiftsPage() {
  return (
    <Suspense>
      <ShiftsView />
    </Suspense>
  );
}
