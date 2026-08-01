'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { designationCreateSchema } from '@hrms/shared';
import { Input } from '@hrms/ui/components/input';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { CrudShell } from '@/components/crud/crud-shell';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { DataTable } from '@/components/data-table';
import { Field } from '@/features/auth/components/field';
import { designationsApi } from '@/features/organization/api';
import type { Designation } from '@/features/organization/types';
import { useCrudList, useCrudMutations } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const KEY = 'org-designations';
type FormValues = z.input<typeof designationCreateSchema>;

function DesignationsView() {
  const params = useListParams('title');
  const list = useCrudList(KEY, designationsApi, {
    page: params.page,
    limit: 10,
    search: params.search,
    sort: params.sort,
    order: params.order,
  });
  const { create, update, remove } = useCrudMutations(KEY, designationsApi, 'Designation');

  const [editing, setEditing] = useState<Designation | 'new' | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(designationCreateSchema) });

  const openNew = () => {
    form.reset({ title: '', level: 0 });
    setEditing('new');
  };
  const openEdit = (row: Designation) => {
    form.reset({ title: row.title, level: row.level });
    setEditing(row);
  };

  const submit = form.handleSubmit(async (raw) => {
    const input = designationCreateSchema.parse(raw);
    if (editing === 'new') await create.mutateAsync(input);
    else if (editing) await update.mutateAsync({ id: editing.id, input });
    setEditing(null);
  });

  return (
    <CrudShell
      title="Designations"
      description="Job titles with a seniority level for org-chart ordering"
      search={params.search}
      onSearchChange={params.setSearch}
      onAdd={openNew}
      addLabel="Add designation"
    >
      <DataTable
        columns={[
          {
            key: 'title',
            header: 'Title',
            sortable: true,
            render: (d) => <span className="font-medium">{d.title}</span>,
          },
          {
            key: 'level',
            header: 'Level',
            sortable: true,
            render: (d) => <span className="tabular-nums">{d.level}</span>,
          },
          {
            key: 'employees',
            header: 'Employees',
            className: 'hidden sm:table-cell',
            render: (d) => (
              <span className="text-muted-foreground tabular-nums">{d._count.employees}</span>
            ),
          },
        ]}
        rows={list.data?.data}
        rowKey={(d) => d.id}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => list.refetch()}
        sort={params.sort}
        order={params.order}
        onSortChange={params.toggleSort}
        meta={list.data?.meta}
        onPageChange={params.setPage}
        emptyTitle="No designations yet"
        actions={(d) => (
          <RowActions
            name={d.title}
            onEdit={() => openEdit(d)}
            onDelete={() => remove.mutate(d.id)}
            deleting={remove.isPending}
          />
        )}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'Add designation' : 'Edit designation'}
        onSubmit={submit}
        submitting={create.isPending || update.isPending}
        submitLabel={editing === 'new' ? 'Create' : 'Save'}
      >
        <Field label="Title" error={form.formState.errors.title?.message}>
          {(a11y) => <Input {...a11y} autoFocus {...form.register('title')} />}
        </Field>
        <Field
          label="Level"
          error={form.formState.errors.level?.message}
          hint="0–20, higher = more senior"
        >
          {(a11y) => <Input {...a11y} type="number" min={0} max={20} {...form.register('level')} />}
        </Field>
      </FormDialog>
    </CrudShell>
  );
}

export default function DesignationsPage() {
  return (
    <Suspense>
      <DesignationsView />
    </Suspense>
  );
}
