'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { locationCreateSchema } from '@hrms/shared';
import type { LocationType } from '@hrms/types';
import { Badge } from '@hrms/ui/components/badge';
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
import type { z } from 'zod';
import { CrudShell } from '@/components/crud/crud-shell';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { DataTable } from '@/components/data-table';
import { Field } from '@/features/auth/components/field';
import { locationsApi } from '@/features/organization/api';
import type { Location } from '@/features/organization/types';
import { useCrudList, useCrudMutations } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const KEY = 'org-locations';
const ALL = 'all';
type FormValues = z.input<typeof locationCreateSchema>;

const TYPE_LABEL: Record<LocationType, string> = {
  HEAD_OFFICE: 'Head office',
  BRANCH: 'Branch',
  REMOTE: 'Remote',
  CLIENT_SITE: 'Client site',
};

function LocationsView() {
  const params = useListParams('name');
  const typeFilter = params.get('type');
  const list = useCrudList(KEY, locationsApi, {
    page: params.page,
    limit: 10,
    search: params.search,
    sort: params.sort,
    order: params.order,
    type: typeFilter,
  });
  const { create, update, remove } = useCrudMutations(KEY, locationsApi, 'Location');

  const [editing, setEditing] = useState<Location | 'new' | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(locationCreateSchema) });
  const type = form.watch('type') ?? 'BRANCH';

  const openNew = () => {
    form.reset({ name: '', type: 'BRANCH', address: '', city: '', country: '', timezone: '' });
    setEditing('new');
  };
  const openEdit = (row: Location) => {
    form.reset({
      name: row.name,
      type: row.type,
      address: row.address ?? '',
      city: row.city ?? '',
      country: row.country ?? '',
      timezone: row.timezone ?? '',
    });
    setEditing(row);
  };

  const submit = form.handleSubmit(async (raw) => {
    const input = locationCreateSchema.parse(raw);
    if (editing === 'new') await create.mutateAsync(input);
    else if (editing) await update.mutateAsync({ id: editing.id, input });
    setEditing(null);
  });

  return (
    <CrudShell
      title="Locations & branches"
      description="Offices, branches, remote and client sites — one list, filtered by type"
      search={params.search}
      onSearchChange={params.setSearch}
      onAdd={openNew}
      addLabel="Add location"
      filters={
        <Select
          value={typeFilter ?? ALL}
          onValueChange={(v) => params.setFilter('type', v === ALL ? undefined : v)}
        >
          <SelectTrigger className="w-40" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            sortable: true,
            render: (l) => <span className="font-medium">{l.name}</span>,
          },
          {
            key: 'type',
            header: 'Type',
            sortable: true,
            render: (l) => <Badge variant="secondary">{TYPE_LABEL[l.type]}</Badge>,
          },
          {
            key: 'city',
            header: 'City',
            sortable: true,
            className: 'hidden sm:table-cell',
            render: (l) => l.city ?? '—',
          },
          {
            key: 'country',
            header: 'Country',
            sortable: true,
            className: 'hidden md:table-cell',
            render: (l) => l.country ?? '—',
          },
          {
            key: 'employees',
            header: 'Employees',
            className: 'hidden lg:table-cell',
            render: (l) => (
              <span className="text-muted-foreground tabular-nums">{l._count.employees}</span>
            ),
          },
        ]}
        rows={list.data?.data}
        rowKey={(l) => l.id}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => list.refetch()}
        sort={params.sort}
        order={params.order}
        onSortChange={params.toggleSort}
        meta={list.data?.meta}
        onPageChange={params.setPage}
        emptyTitle="No locations yet"
        emptyHint="Add your head office or first branch"
        actions={(l) => (
          <RowActions
            name={l.name}
            onEdit={() => openEdit(l)}
            onDelete={() => remove.mutate(l.id)}
            deleting={remove.isPending}
          />
        )}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'Add location' : 'Edit location'}
        onSubmit={submit}
        submitting={create.isPending || update.isPending}
        submitLabel={editing === 'new' ? 'Create' : 'Save'}
      >
        <Field label="Name" error={form.formState.errors.name?.message}>
          {(a11y) => <Input {...a11y} autoFocus {...form.register('name')} />}
        </Field>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select
            value={type}
            onValueChange={(v) => form.setValue('type', v as LocationType, { shouldDirty: true })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Field label="Address" error={form.formState.errors.address?.message}>
          {(a11y) => <Input {...a11y} {...form.register('address')} />}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="City" error={form.formState.errors.city?.message}>
            {(a11y) => <Input {...a11y} {...form.register('city')} />}
          </Field>
          <Field label="Country" error={form.formState.errors.country?.message}>
            {(a11y) => <Input {...a11y} {...form.register('country')} />}
          </Field>
        </div>
        <Field
          label="Timezone"
          error={form.formState.errors.timezone?.message}
          hint="Optional — overrides the company default"
        >
          {(a11y) => (
            <>
              <Input {...a11y} list="loc-tz" {...form.register('timezone')} />
              <datalist id="loc-tz">
                {Intl.supportedValuesOf('timeZone').map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      </FormDialog>
    </CrudShell>
  );
}

export default function LocationsPage() {
  return (
    <Suspense>
      <LocationsView />
    </Suspense>
  );
}
