'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { holidayCreateSchema } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
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
import { FormCheckbox, FormDatePicker, FormInput, FormSelect } from '@/components/form';
import { holidaysApi, locationsApi } from '@/features/organization/api';
import type { Holiday } from '@/features/organization/types';
import { useCrudList, useCrudMutations, useOptions } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const KEY = 'org-holidays';
const ALL = 'all';
type FormValues = z.input<typeof holidayCreateSchema>;

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function HolidaysView() {
  const currentYear = new Date().getFullYear();
  const params = useListParams('date');
  const year = params.get('year') ?? String(currentYear);
  const locationFilter = params.get('locationId');

  const list = useCrudList(KEY, holidaysApi, {
    page: params.page,
    limit: 10,
    search: params.search,
    sort: params.sort,
    order: params.order,
    year,
    locationId: locationFilter,
  });
  const { create, update, remove } = useCrudMutations(KEY, holidaysApi, 'Holiday');
  const locations = useOptions('org-locations', locationsApi.options, (l) => l.name);

  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(holidayCreateSchema) });

  const openNew = () => {
    form.reset({ name: '', date: '', locationId: null, isOptional: false });
    setEditing('new');
  };
  const openEdit = (row: Holiday) => {
    form.reset({
      name: row.name,
      date: row.date.slice(0, 10),
      locationId: row.locationId,
      isOptional: row.isOptional,
    });
    setEditing(row);
  };

  const submit = form.handleSubmit(async (raw) => {
    const input = holidayCreateSchema.parse(raw);
    if (editing === 'new') await create.mutateAsync(input);
    else if (editing) await update.mutateAsync({ id: editing.id, input });
    setEditing(null);
  });

  const years = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i);

  return (
    <CrudShell
      title="Holiday calendar"
      description="Company holidays — org-wide or specific to a location"
      search={params.search}
      onSearchChange={params.setSearch}
      onAdd={openNew}
      addLabel="Add holiday"
      filters={
        <>
          <Select value={year} onValueChange={(v) => params.setFilter('year', v)}>
            <SelectTrigger className="w-28" aria-label="Filter by year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={locationFilter ?? ALL}
            onValueChange={(v) => params.setFilter('locationId', v === ALL ? undefined : v)}
          >
            <SelectTrigger className="w-44" aria-label="Filter by location">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All locations</SelectItem>
              {locations.options?.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
    >
      <DataTable
        columns={[
          {
            key: 'date',
            header: 'Date',
            sortable: true,
            render: (h) => <span className="tabular-nums">{dateFmt.format(new Date(h.date))}</span>,
          },
          {
            key: 'name',
            header: 'Holiday',
            sortable: true,
            render: (h) => (
              <span className="font-medium">
                {h.name}{' '}
                {h.isOptional && (
                  <Badge variant="outline" className="ml-1 align-middle">
                    Optional
                  </Badge>
                )}
              </span>
            ),
          },
          {
            key: 'location',
            header: 'Applies to',
            className: 'hidden sm:table-cell',
            render: (h) => h.location?.name ?? 'Entire organization',
          },
        ]}
        rows={list.data?.data}
        rowKey={(h) => h.id}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => list.refetch()}
        sort={params.sort}
        order={params.order}
        onSortChange={params.toggleSort}
        meta={list.data?.meta}
        onPageChange={params.setPage}
        emptyTitle={`No holidays in ${year}`}
        emptyHint="Add public and company holidays for the year"
        actions={(h) => (
          <RowActions
            name={h.name}
            onEdit={() => openEdit(h)}
            onDelete={() => remove.mutate(h.id)}
            deleting={remove.isPending}
          />
        )}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'Add holiday' : 'Edit holiday'}
        onSubmit={submit}
        submitting={create.isPending || update.isPending}
        submitLabel={editing === 'new' ? 'Create' : 'Save'}
      >
        <FormInput
          control={form.control}
          name="name"
          label="Name"
          autoFocus
          placeholder="e.g. Independence Day"
        />
        <FormDatePicker
          control={form.control}
          name="date"
          label="Date"
          placeholder="Select the holiday date"
        />
        <FormSelect
          control={form.control}
          name="locationId"
          label="Applies to"
          emptyLabel="Entire organization"
          busy={locations.isPending}
        >
          {locations.options?.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormCheckbox
          control={form.control}
          name="isOptional"
          label="Optional holiday (employees may choose to work)"
        />
      </FormDialog>
    </CrudShell>
  );
}

export default function HolidaysPage() {
  return (
    <Suspense>
      <HolidaysView />
    </Suspense>
  );
}
