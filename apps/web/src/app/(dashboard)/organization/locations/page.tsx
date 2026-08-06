'use client';

import { locationCreateSchema } from '@hrms/shared';
import type { LocationType } from '@hrms/types';
import { Badge } from '@hrms/ui/components/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { TriangleAlert } from 'lucide-react';
import { Suspense, useState } from 'react';
import type { z } from 'zod';
import { CrudShell } from '@/components/crud/crud-shell';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { DataTable } from '@/components/data-table';
import { FormField, FormInput, FormSelect } from '@/components/form';
import { TimezoneField } from '@/components/timezone-field';
import { locationsApi } from '@/features/organization/api';
import type { Location } from '@/features/organization/types';
import { useCrudList, useCrudMutations } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';
import { useZodForm } from '@/hooks/use-zod-form';

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
  const form = useZodForm<FormValues>(locationCreateSchema);

  const openNew = () => {
    form.reset({
      name: '',
      type: 'BRANCH',
      address: '',
      city: '',
      country: '',
      timezone: '',
      latitude: '' as unknown as undefined,
      longitude: '' as unknown as undefined,
      geofenceRadiusMeters: 200,
    });
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
      latitude: (row.latitude ?? '') as unknown as undefined,
      longitude: (row.longitude ?? '') as unknown as undefined,
      geofenceRadiusMeters: row.geofenceRadiusMeters,
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
            key: 'geofence',
            header: 'On the map',
            className: 'hidden md:table-cell',
            // Said where it is fixed rather than in the docs: until a place has
            // coordinates, attendance cannot tell an office day from a remote
            // one and records everything as an unconfirmed office day.
            render: (l) =>
              l.latitude !== null && l.longitude !== null ? (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {l.latitude.toFixed(4)}, {l.longitude.toFixed(4)} · {l.geofenceRadiusMeters} m
                </span>
              ) : (
                <Badge className="border-transparent bg-warning/15 text-warning-text">
                  <TriangleAlert className="size-3" aria-hidden /> No coordinates
                </Badge>
              ),
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
        <FormInput control={form.control} name="name" label="Name" autoFocus />
        <FormSelect control={form.control} name="type" label="Type">
          {Object.entries(TYPE_LABEL).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormInput control={form.control} name="address" label="Address" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormInput control={form.control} name="city" label="City" />
          <FormInput control={form.control} name="country" label="Country" />
        </div>
        {/* TimezoneField is a local composite, so it uses the escape hatch. */}
        <FormField
          control={form.control}
          name="timezone"
          label="Timezone"
          hint="Optional — overrides the company default"
        >
          {({ field, a11y }) => (
            <TimezoneField
              {...a11y}
              value={field.value}
              onValueChange={field.onChange}
              placeholder="Same as company default"
            />
          )}
        </FormField>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="font-medium text-sm">Attendance geofence</p>
          <p className="text-muted-foreground text-xs">
            Coordinates let someone clocking in as "Office" be checked against this place. Leave
            them empty and nobody is checked against it — a missing fence never counts against
            anyone.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormInput
              control={form.control}
              name="latitude"
              label="Latitude"
              inputMode="decimal"
              placeholder="23.0225"
            />
            <FormInput
              control={form.control}
              name="longitude"
              label="Longitude"
              inputMode="decimal"
              placeholder="72.5714"
            />
          </div>
          <FormInput
            control={form.control}
            name="geofenceRadiusMeters"
            label="Radius in metres"
            hint="How far from the coordinates still counts as being here"
            inputMode="numeric"
          />
        </div>
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
