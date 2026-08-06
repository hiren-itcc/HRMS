'use client';

import { type DepartmentCreateInput, departmentCreateSchema } from '@hrms/shared';
import { SelectItem } from '@hrms/ui/components/select';
import { Suspense, useState } from 'react';
import { CrudShell } from '@/components/crud/crud-shell';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { DataTable } from '@/components/data-table';
import { FormInput, FormSelect } from '@/components/form';
import { departmentsApi } from '@/features/organization/api';
import type { Department } from '@/features/organization/types';
import { useCrudList, useCrudMutations, useOptions } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';
import { useZodForm } from '@/hooks/use-zod-form';

const KEY = 'org-departments';

function DepartmentsView() {
  const params = useListParams('name');
  const list = useCrudList(KEY, departmentsApi, {
    page: params.page,
    limit: 10,
    search: params.search,
    sort: params.sort,
    order: params.order,
  });
  const { create, update, remove } = useCrudMutations(KEY, departmentsApi, 'Department');
  const options = useOptions(KEY, departmentsApi.options, (d) => d.name);

  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const form = useZodForm<DepartmentCreateInput>(departmentCreateSchema);

  const openNew = () => {
    form.reset({ name: '', code: '', parentId: null });
    setEditing('new');
  };
  const openEdit = (row: Department) => {
    form.reset({ name: row.name, code: row.code ?? '', parentId: row.parentId });
    setEditing(row);
  };

  const submit = form.handleSubmit(async (input) => {
    if (editing === 'new') await create.mutateAsync(input);
    else if (editing) await update.mutateAsync({ id: editing.id, input });
    setEditing(null);
  });

  return (
    <CrudShell
      title="Departments"
      description="Team structure — departments can nest under a parent"
      search={params.search}
      onSearchChange={params.setSearch}
      onAdd={openNew}
      addLabel="Add department"
    >
      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            sortable: true,
            render: (d) => <span className="font-medium">{d.name}</span>,
          },
          {
            key: 'code',
            header: 'Code',
            sortable: true,
            className: 'hidden sm:table-cell',
            render: (d) => d.code ?? '—',
          },
          {
            key: 'parent',
            header: 'Parent',
            className: 'hidden md:table-cell',
            render: (d) => d.parent?.name ?? '—',
          },
          {
            key: 'counts',
            header: 'Members',
            className: 'hidden md:table-cell',
            render: (d) => (
              <span className="text-muted-foreground tabular-nums">
                {d._count.employees} <span className="text-xs">emp</span> · {d._count.children}{' '}
                <span className="text-xs">sub</span>
              </span>
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
        emptyTitle="No departments yet"
        emptyHint="Create the first department to start structuring the org"
        actions={(d) => (
          <RowActions
            name={d.name}
            onEdit={() => openEdit(d)}
            onDelete={() => remove.mutate(d.id)}
            deleting={remove.isPending}
          />
        )}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'Add department' : 'Edit department'}
        onSubmit={submit}
        submitting={create.isPending || update.isPending}
        submitLabel={editing === 'new' ? 'Create' : 'Save'}
      >
        <FormInput control={form.control} name="name" label="Name" autoFocus />
        <FormInput
          control={form.control}
          name="code"
          label="Code"
          hint="Optional short code, e.g. ENG"
        />
        <FormSelect
          control={form.control}
          name="parentId"
          label="Parent department"
          placeholder="None"
          emptyLabel="None (top level)"
          busy={options.isPending}
        >
          {/* A department cannot be its own parent. */}
          {options.options
            ?.filter((o) => editing === 'new' || o.id !== (editing as Department)?.id)
            .map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
        </FormSelect>
      </FormDialog>
    </CrudShell>
  );
}

export default function DepartmentsPage() {
  return (
    <Suspense>
      <DepartmentsView />
    </Suspense>
  );
}
