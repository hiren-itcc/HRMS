'use client';

import { type EmploymentTypeCreateInput, employmentTypeCreateSchema } from '@hrms/shared';
import { Suspense, useState } from 'react';
import { CrudShell } from '@/components/crud/crud-shell';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { DataTable } from '@/components/data-table';
import { FormInput } from '@/components/form';
import { employmentTypesApi } from '@/features/organization/api';
import type { EmploymentTypeRow } from '@/features/organization/types';
import { useCrudList, useCrudMutations } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';
import { useZodForm } from '@/hooks/use-zod-form';

const KEY = 'org-employment-types';

function EmploymentTypesView() {
  const params = useListParams('name');
  const list = useCrudList(KEY, employmentTypesApi, {
    page: params.page,
    limit: 10,
    search: params.search,
    sort: params.sort,
    order: params.order,
  });
  const { create, update, remove } = useCrudMutations(KEY, employmentTypesApi, 'Employment type');

  const [editing, setEditing] = useState<EmploymentTypeRow | 'new' | null>(null);
  const form = useZodForm<EmploymentTypeCreateInput>(employmentTypeCreateSchema);

  const openNew = () => {
    form.reset({ name: '', code: '' });
    setEditing('new');
  };
  const openEdit = (row: EmploymentTypeRow) => {
    form.reset({ name: row.name, code: row.code ?? '' });
    setEditing(row);
  };

  const submit = form.handleSubmit(async (input) => {
    if (editing === 'new') await create.mutateAsync(input);
    else if (editing) await update.mutateAsync({ id: editing.id, input });
    setEditing(null);
  });

  return (
    <CrudShell
      title="Employment types"
      description="Full-time, part-time, contract… — assignable to employees"
      search={params.search}
      onSearchChange={params.setSearch}
      onAdd={openNew}
      addLabel="Add type"
    >
      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            sortable: true,
            render: (t) => <span className="font-medium">{t.name}</span>,
          },
          { key: 'code', header: 'Code', sortable: true, render: (t) => t.code ?? '—' },
          {
            key: 'employees',
            header: 'Employees',
            className: 'hidden sm:table-cell',
            render: (t) => (
              <span className="text-muted-foreground tabular-nums">{t._count.employees}</span>
            ),
          },
        ]}
        rows={list.data?.data}
        rowKey={(t) => t.id}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => list.refetch()}
        sort={params.sort}
        order={params.order}
        onSortChange={params.toggleSort}
        meta={list.data?.meta}
        onPageChange={params.setPage}
        emptyTitle="No employment types yet"
        actions={(t) => (
          <RowActions
            name={t.name}
            onEdit={() => openEdit(t)}
            onDelete={() => remove.mutate(t.id)}
            deleting={remove.isPending}
          />
        )}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'Add employment type' : 'Edit employment type'}
        onSubmit={submit}
        submitting={create.isPending || update.isPending}
        submitLabel={editing === 'new' ? 'Create' : 'Save'}
      >
        <FormInput control={form.control} name="name" label="Name" autoFocus />
        <FormInput control={form.control} name="code" label="Code" hint="Optional, e.g. FT" />
      </FormDialog>
    </CrudShell>
  );
}

export default function EmploymentTypesPage() {
  return (
    <Suspense>
      <EmploymentTypesView />
    </Suspense>
  );
}
