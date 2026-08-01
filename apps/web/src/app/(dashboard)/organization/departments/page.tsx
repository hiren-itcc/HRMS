'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type DepartmentCreateInput, departmentCreateSchema } from '@hrms/shared';
import { Input } from '@hrms/ui/components/input';
import { Label } from '@hrms/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { CrudShell } from '@/components/crud/crud-shell';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/field';
import { departmentsApi } from '@/features/organization/api';
import type { Department } from '@/features/organization/types';
import { useCrudList, useCrudMutations, useOptions } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const KEY = 'org-departments';
const NONE = 'none';

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
  const options = useOptions(KEY, departmentsApi.options);

  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const form = useForm<DepartmentCreateInput>({
    resolver: zodResolver(departmentCreateSchema),
  });
  const parentId = form.watch('parentId');

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
        <Field label="Name" error={form.formState.errors.name?.message}>
          {(a11y) => <Input {...a11y} autoFocus {...form.register('name')} />}
        </Field>
        <Field
          label="Code"
          error={form.formState.errors.code?.message}
          hint="Optional short code, e.g. ENG"
        >
          {(a11y) => <Input {...a11y} {...form.register('code')} />}
        </Field>
        <div className="space-y-2">
          <Label htmlFor="parent-department">Parent department</Label>
          <Select
            value={parentId ?? NONE}
            onValueChange={(v) =>
              form.setValue('parentId', v === NONE ? null : v, { shouldDirty: true })
            }
          >
            <SelectTrigger id="parent-department" className="w-full">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None (top level)</SelectItem>
              {options.data
                ?.filter((o) => editing === 'new' || o.id !== (editing as Department)?.id)
                .map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
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
