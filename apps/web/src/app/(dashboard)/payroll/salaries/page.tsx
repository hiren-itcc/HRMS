'use client';

import { DatePicker } from '@hrms/ui/components/date-picker';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil } from 'lucide-react';
import { useState } from 'react';
import { CrudShell } from '@/components/crud/crud-shell';
import { FormDialog } from '@/components/crud/form-dialog';
import { type Column, DataTable } from '@/components/data-table';
import { Field } from '@/components/field';
import { IconAction } from '@/components/icon-action';
import { useSession } from '@/components/session-provider';
import { formatMoney, payrollApi, payrollKeys } from '@/features/payroll/api';
import type { SalaryRow } from '@/features/payroll/types';
import { useApiMutation, useOptions } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const REVISION_TYPES = [
  ['JOINING', 'On joining'],
  ['INCREMENT', 'Increment'],
  ['PROMOTION', 'Promotion'],
  ['TRANSFER', 'Transfer'],
  ['ADJUSTMENT', 'Adjustment'],
] as const;

const ALL = '__all__';

export default function SalariesPage() {
  const params = useListParams('firstName');
  const queryClient = useQueryClient();
  const { can } = useSession();
  const structureFilter = params.get('structureId');

  const [editing, setEditing] = useState<SalaryRow | null>(null);
  const [form, setForm] = useState({
    structureId: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    monthlyCtc: '',
    monthlyTds: '0',
    revisionType: 'INCREMENT',
    reason: '',
  });

  const listQuery = {
    page: params.page,
    limit: 10,
    search: params.search,
    sort: params.sort,
    order: params.order,
    structureId: structureFilter,
  };
  const list = useQuery({
    queryKey: [...payrollKeys.salaries(), listQuery],
    queryFn: () => payrollApi.salaries(listQuery),
  });
  // Keyed under payrollKeys.structures() so editing a structure reaches it.
  const structures = useOptions(
    payrollKeys.structures(),
    payrollApi.structureOptions,
    (s) => s.name,
  );

  const assign = useApiMutation({
    error: 'Could not save the salary',
    mutationFn: () =>
      payrollApi.assignSalary({
        employeeId: editing?.employeeId as string,
        structureId: form.structureId,
        effectiveFrom: form.effectiveFrom,
        monthlyCtc: Number(form.monthlyCtc),
        monthlyTds: Number(form.monthlyTds || 0),
        revisionType: form.revisionType as 'INCREMENT',
        reason: form.reason || null,
        paymentMethod: 'BANK_TRANSFER',
      }),
    success: 'Salary saved',
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: payrollKeys.salaries() });
    },
  });

  const openFor = (row: SalaryRow) => {
    setEditing(row);
    setForm({
      structureId: row.current?.structureId ?? structures.options?.[0]?.id ?? '',
      effectiveFrom: new Date().toISOString().slice(0, 10),
      monthlyCtc: row.current ? String(row.current.monthlyCtc) : '',
      monthlyTds: row.current ? String(row.current.monthlyTds) : '0',
      revisionType: row.current ? 'INCREMENT' : 'JOINING',
      reason: '',
    });
  };

  const columns: Column<SalaryRow>[] = [
    {
      key: 'name',
      header: 'Employee',
      alwaysVisible: true,
      render: (row) => (
        <span>
          <span className="font-medium">{row.name}</span>
          <span className="block text-muted-foreground text-xs">{row.employeeCode}</span>
        </span>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      className: 'hidden lg:table-cell',
      render: (row) => row.department ?? '—',
    },
    {
      key: 'structure',
      header: 'Structure',
      className: 'hidden md:table-cell',
      render: (row) => row.current?.structureName ?? '—',
    },
    {
      key: 'monthlyCtc',
      header: 'Monthly CTC',
      className: 'tabular-nums',
      render: (row) =>
        row.current ? (
          <span className="font-medium">{formatMoney(row.current.monthlyCtc)}</span>
        ) : (
          <span className="text-muted-foreground">Not assigned</span>
        ),
    },
    {
      key: 'effectiveFrom',
      header: 'Effective',
      className: 'hidden sm:table-cell',
      render: (row) => row.current?.effectiveFrom ?? '—',
    },
  ];

  return (
    <>
      <CrudShell
        title="Employee salaries"
        description="Assign a structure and CTC; every change becomes a dated revision"
        search={params.search}
        onSearchChange={params.setSearch}
        managePerm="payroll.salary.manage"
        filters={
          <Select
            value={structureFilter ?? ALL}
            onValueChange={(value) =>
              params.setFilter('structureId', value === ALL ? undefined : value)
            }
          >
            <SelectTrigger className="w-52" aria-label="Filter by structure">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All structures</SelectItem>
              {structures.options?.map((structure) => (
                <SelectItem key={structure.id} value={structure.id}>
                  {structure.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        <DataTable
          columns={columns}
          rows={list.data?.data}
          rowKey={(row) => row.employeeId}
          loading={list.isLoading}
          error={list.isError}
          onRetry={() => list.refetch()}
          meta={list.data?.meta}
          onPageChange={params.setPage}
          sort={params.sort}
          order={params.order}
          onSortChange={params.toggleSort}
          emptyTitle="No employees match"
          actions={
            can('payroll.salary.manage')
              ? (row) => (
                  <>
                    <IconAction
                      label={`Revise salary for ${row.name}`}
                      icon={Pencil}
                      size="icon-sm"
                      onClick={() => openFor(row)}
                    />
                    <IconAction
                      label={`Salary history for ${row.name}`}
                      icon={History}
                      size="icon-sm"
                      render={<a href={`/payroll/salaries/${row.employeeId}`} />}
                    />
                  </>
                )
              : undefined
          }
        />
      </CrudShell>

      <FormDialog
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        title={editing?.current ? `Revise ${editing.name}'s salary` : `Assign a salary`}
        description="A revision is dated; the previous figure stays in the history."
        onSubmit={(e) => {
          e.preventDefault();
          assign.mutate();
        }}
        submitting={assign.isPending}
        submitLabel="Save revision"
      >
        <Field label="Salary structure" required>
          {(a11y) => (
            <Select
              value={form.structureId}
              onValueChange={(value) => setForm((f) => ({ ...f, structureId: value }))}
            >
              <SelectTrigger id={a11y.id} className="w-full">
                <SelectValue placeholder="Choose a structure" />
              </SelectTrigger>
              <SelectContent>
                {structures.options?.map((structure) => (
                  <SelectItem key={structure.id} value={structure.id}>
                    {structure.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Monthly CTC" required>
            {(a11y) => (
              <Input
                {...a11y}
                type="number"
                min={1}
                value={form.monthlyCtc}
                onChange={(e) => setForm((f) => ({ ...f, monthlyCtc: e.target.value }))}
              />
            )}
          </Field>
          <Field label="Monthly TDS" hint="Entered, not projected">
            {(a11y) => (
              <Input
                {...a11y}
                type="number"
                min={0}
                value={form.monthlyTds}
                onChange={(e) => setForm((f) => ({ ...f, monthlyTds: e.target.value }))}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Effective from" required>
            {(a11y) => (
              <DatePicker
                {...a11y}
                value={form.effectiveFrom}
                onValueChange={(value) => setForm((f) => ({ ...f, effectiveFrom: value }))}
              />
            )}
          </Field>
          <Field label="Reason for change">
            {(a11y) => (
              <Select
                value={form.revisionType}
                onValueChange={(value) => setForm((f) => ({ ...f, revisionType: value }))}
              >
                <SelectTrigger id={a11y.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REVISION_TYPES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>

        <Field label="Note" hint="Shown on the revision timeline and in the audit log">
          {(a11y) => (
            <Input
              {...a11y}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Annual increment"
            />
          )}
        </Field>
      </FormDialog>
    </>
  );
}
