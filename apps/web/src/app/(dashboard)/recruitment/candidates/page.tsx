'use client';

import { candidateCreateSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { SelectItem } from '@hrms/ui/components/select';
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
import { type CandidateRow, recruitmentApi, recruitmentKeys } from '@/features/recruitment/api';
import { useJobOptions } from '@/features/recruitment/use-job-options';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

const PAGE_SIZE = 20;

type CandidateValues = z.input<typeof candidateCreateSchema>;

const EMPTY: CandidateValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: undefined,
  currentEmployer: undefined,
  currentTitle: undefined,
  noticePeriodDays: '',
  expectedMonthlyCtc: '',
  source: undefined,
  referrerId: undefined,
  notes: undefined,
};

/** Where the candidate came from. Free text on the API; these are the usual answers. */
const SOURCES = ['Referral', 'Careers page', 'LinkedIn', 'Naukri', 'Agency', 'Walk-in', 'Other'];

export default function CandidatesPage() {
  const { can } = useSession();
  const canManage = can('recruitment.candidate.manage');
  const options = useJobOptions();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const params = { page, limit: PAGE_SIZE, ...(search.trim() ? { search: search.trim() } : {}) };
  const query = useQuery({
    queryKey: recruitmentKeys.candidates(params),
    queryFn: () => recruitmentApi.candidates(params),
  });

  const form = useZodForm<CandidateValues>(candidateCreateSchema, { defaultValues: EMPTY });

  const create = useApiMutation({
    mutationFn: (values: CandidateValues) =>
      recruitmentApi.createCandidate(candidateCreateSchema.parse(values)),
    invalidate: [recruitmentKeys.all()],
    success: 'Added to the pool',
    onSuccess: () => setAdding(false),
  });

  const columns: Column<CandidateRow>[] = [
    {
      key: 'name',
      header: 'Name',
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/recruitment/candidates/${row.id}`} className="hover:underline">
          <span className="font-medium">
            {row.firstName} {row.lastName}
          </span>
          <span className="block text-muted-foreground text-xs">{row.email}</span>
        </Link>
      ),
    },
    {
      key: 'current',
      header: 'Currently',
      className: 'hidden sm:table-cell',
      render: (row) =>
        row.currentTitle || row.currentEmployer ? (
          <span>
            {row.currentTitle ?? '—'}
            {row.currentEmployer && (
              <span className="block text-muted-foreground text-xs">{row.currentEmployer}</span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'expectedMonthlyCtc',
      header: 'Expects',
      className: 'hidden lg:table-cell',
      render: (row) => (
        <span className="tabular-nums">
          {row.expectedMonthlyCtc === null ? '—' : formatMoney(row.expectedMonthlyCtc)}
        </span>
      ),
    },
    {
      key: 'noticePeriodDays',
      header: 'Notice',
      className: 'hidden lg:table-cell',
      render: (row) => (
        <span className="tabular-nums">
          {row.noticePeriodDays === null ? '—' : `${row.noticePeriodDays} days`}
        </span>
      ),
    },
    {
      key: 'applications',
      header: 'Applications',
      render: (row) => <span className="tabular-nums">{row._count.applications}</span>,
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
          placeholder="Name or email"
          aria-label="Search candidates"
          className="w-full sm:w-64"
        />

        {canManage && (
          <Button
            className="sm:ml-auto"
            onClick={() => {
              form.reset(EMPTY);
              setAdding(true);
            }}
          >
            <Plus className="size-4" aria-hidden /> Add a candidate
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
        emptyTitle={search ? 'Nobody matches that' : 'Nobody on file yet'}
        emptyHint={
          search
            ? 'Try part of a name, or the email address.'
            : 'Add somebody once, then put them forward for as many openings as you like.'
        }
        actions={(row) => (
          <IconAction
            label={`View ${row.firstName} ${row.lastName}`}
            icon={Eye}
            render={<Link href={`/recruitment/candidates/${row.id}`} />}
          />
        )}
      />

      <FormDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a candidate"
        description="One record per person, not per application — a re-applicant is the same human."
        submitting={create.isPending}
        submitLabel="Add"
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <FormInput control={form.control} name="firstName" label="First name" placeholder="Nadia" />
        <FormInput control={form.control} name="lastName" label="Last name" placeholder="Rahman" />
        <FormInput
          control={form.control}
          name="email"
          placeholder="nadia.rahman@example.com"
          label="Email"
          type="email"
          hint="Unique per organization — it is what makes a re-applicant the same person."
        />
        <FormInput control={form.control} name="phone" label="Phone" placeholder="Optional" />
        <FormInput
          control={form.control}
          name="currentTitle"
          label="Current title"
          placeholder="Optional"
        />
        <FormInput
          control={form.control}
          name="currentEmployer"
          label="Current employer"
          placeholder="Optional"
        />
        <FormInput
          control={form.control}
          name="noticePeriodDays"
          label="Notice period, in days"
          type="number"
          min={0}
          placeholder="Optional"
        />
        <FormInput
          control={form.control}
          name="expectedMonthlyCtc"
          label="Expected monthly CTC"
          type="number"
          min={0}
          placeholder="Optional"
        />
        <FormSelect
          control={form.control}
          name="source"
          label="Where they came from"
          emptyLabel="Not recorded"
          emptyValue={undefined}
        >
          {SOURCES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </FormSelect>
        <FormSelect
          control={form.control}
          name="referrerId"
          label="Referred by"
          hint="If a colleague put them forward."
          emptyLabel="Nobody"
          emptyValue={undefined}
          busy={options.employees.isPending}
        >
          {(options.employees.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormTextarea
          control={form.control}
          name="notes"
          label="Notes"
          placeholder="Optional"
          rows={3}
        />
      </FormDialog>
    </div>
  );
}
