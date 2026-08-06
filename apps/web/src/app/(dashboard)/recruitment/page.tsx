'use client';

import {
  OPENING_STATUS_LABELS,
  OPENING_STATUSES,
  type OpeningStatusCode,
  openingCreateSchema,
} from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Eye, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { type Column, DataTable } from '@/components/data-table';
import { FormInput, FormSelect, FormTextarea } from '@/components/form';
import { IconAction } from '@/components/icon-action';
import { useSession } from '@/components/session-provider';
import { formatMoney } from '@/features/payroll/api';
import {
  fullName,
  type OpeningRow,
  recruitmentApi,
  recruitmentKeys,
} from '@/features/recruitment/api';
import { OpeningStatusBadge } from '@/features/recruitment/components/recruitment-badges';
import { useJobOptions } from '@/features/recruitment/use-job-options';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

const PAGE_SIZE = 20;

/** The input type: `headcount` carries a zod default, so the form starts without it. */
type OpeningValues = z.input<typeof openingCreateSchema>;

const EMPTY: OpeningValues = {
  title: '',
  departmentId: undefined,
  designationId: undefined,
  locationId: undefined,
  employmentTypeId: undefined,
  hiringManagerId: undefined,
  headcount: 1,
  description: undefined,
};

/**
 * The salary band as it is advertised.
 *
 * Both ends are optional and either can stand alone — "from ₹80,000" is a real
 * advert, and so is a role with no figure at all. Showing ₹0 for an unset band
 * would be a lie rather than a blank, which is why the API sends null.
 */
function band(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${formatMoney(min)} – ${formatMoney(max)}`;
  if (min !== null) return `From ${formatMoney(min)}`;
  if (max !== null) return `Up to ${formatMoney(max)}`;
  return '—';
}

export default function OpeningsPage() {
  const { can } = useSession();
  const canManage = can('recruitment.opening.manage');
  const options = useJobOptions();

  const [status, setStatus] = useState<OpeningStatusCode | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const params = {
    page,
    limit: PAGE_SIZE,
    ...(status === 'ALL' ? {} : { status }),
    ...(search.trim() ? { search: search.trim() } : {}),
  };
  const query = useQuery({
    queryKey: recruitmentKeys.openings(params),
    queryFn: () => recruitmentApi.openings(params),
  });

  const form = useZodForm<OpeningValues>(openingCreateSchema, { defaultValues: EMPTY });

  const create = useApiMutation({
    mutationFn: (values: OpeningValues) =>
      recruitmentApi.createOpening(openingCreateSchema.parse(values)),
    invalidate: [recruitmentKeys.all()],
    success: 'Opening raised — it starts as a draft',
    onSuccess: () => setAdding(false),
  });

  const columns: Column<OpeningRow>[] = [
    {
      key: 'title',
      header: 'Role',
      sortable: true,
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/recruitment/openings/${row.id}`} className="hover:underline">
          <span className="font-medium">{row.title}</span>
          <span className="block text-muted-foreground text-xs">
            {row.department?.name ?? 'No department'}
            {row.location ? ` · ${row.location.name}` : ''}
          </span>
        </Link>
      ),
    },
    {
      key: 'liveApplications',
      header: 'In pipeline',
      render: (row) => (
        <span className="tabular-nums">
          {row.liveApplications}
          <span className="text-muted-foreground"> / {row.headcount} to fill</span>
        </span>
      ),
    },
    {
      key: 'band',
      header: 'Band',
      className: 'hidden lg:table-cell',
      render: (row) => (
        <span className="tabular-nums">{band(row.minMonthlyCtc, row.maxMonthlyCtc)}</span>
      ),
    },
    {
      key: 'hiringManager',
      header: 'Hiring manager',
      className: 'hidden sm:table-cell',
      render: (row) =>
        row.hiringManager ? (
          <Link href={`/employees/${row.hiringManager.id}`} className="hover:underline">
            {fullName(row.hiringManager)}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <OpeningStatusBadge status={row.status} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Job title"
          aria-label="Search openings"
          className="w-full sm:w-64"
        />

        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as OpeningStatusCode | 'ALL');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any status</SelectItem>
            {OPENING_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {OPENING_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canManage && (
          <Button
            className="sm:ml-auto"
            onClick={() => {
              form.reset(EMPTY);
              setAdding(true);
            }}
          >
            <Plus className="size-4" aria-hidden /> Raise an opening
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        meta={query.data?.meta}
        onPageChange={setPage}
        emptyTitle={search ? 'Nothing matches that' : 'Nothing is being recruited for'}
        emptyHint={
          search
            ? 'Try part of the job title.'
            : 'Raise an opening, then put candidates forward against it.'
        }
        actions={(row) => (
          <IconAction
            label={`Open ${row.title}`}
            icon={Eye}
            render={<Link href={`/recruitment/openings/${row.id}`} />}
          />
        )}
      />

      <FormDialog
        open={adding}
        onOpenChange={setAdding}
        title="Raise an opening"
        description="It starts as a draft. Publish it when the role is signed off."
        submitting={create.isPending}
        submitLabel="Raise"
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <FormInput
          control={form.control}
          name="title"
          label="Job title"
          placeholder="Software Engineer"
        />
        <FormSelect
          control={form.control}
          name="departmentId"
          label="Department"
          emptyLabel="Not decided"
          emptyValue={undefined}
          busy={options.departments.isPending}
        >
          {(options.departments.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormSelect
          control={form.control}
          name="designationId"
          label="Designation"
          emptyLabel="Not decided"
          emptyValue={undefined}
          busy={options.designations.isPending}
        >
          {(options.designations.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormSelect
          control={form.control}
          name="locationId"
          label="Location"
          emptyLabel="Not decided"
          emptyValue={undefined}
          busy={options.locations.isPending}
        >
          {(options.locations.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormSelect
          control={form.control}
          name="employmentTypeId"
          label="Employment type"
          emptyLabel="Not decided"
          emptyValue={undefined}
          busy={options.employmentTypes.isPending}
        >
          {(options.employmentTypes.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormSelect
          control={form.control}
          name="hiringManagerId"
          label="Hiring manager"
          hint="They see this opening even without org-wide recruitment access."
          emptyLabel="Nobody yet"
          emptyValue={undefined}
          busy={options.employees.isPending}
        >
          {(options.employees.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormInput
          control={form.control}
          name="headcount"
          label="How many to hire"
          type="number"
          min={1}
        />
        <FormInput
          control={form.control}
          name="minMonthlyCtc"
          label="Band, from"
          type="number"
          placeholder="Optional"
          hint="Monthly cost to company."
        />
        <FormInput
          control={form.control}
          name="maxMonthlyCtc"
          label="Band, to"
          type="number"
          placeholder="Optional"
        />
        <FormTextarea
          control={form.control}
          name="description"
          label="What the job is"
          placeholder="Optional — what they will be doing, and what you are looking for."
          rows={4}
        />
      </FormDialog>
    </div>
  );
}
