'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { leaveBalanceAdjustSchema, leaveTypeCreateSchema } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { DataTable } from '@/components/data-table';
import { FormCheckbox, FormInput } from '@/components/form';
import { IconAction } from '@/components/icon-action';
import { FadeInItem, Stagger } from '@/components/motion';
import { type LeaveBalance, type LeaveType, leaveApi } from '@/features/leave/api';
import { useApiMutation } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

type TypeValues = z.input<typeof leaveTypeCreateSchema>;
type AdjustValues = z.input<typeof leaveBalanceAdjustSchema>;

function LeaveSettingsView() {
  const _queryClient = useQueryClient();
  const params = useListParams('name');
  // Left undefined so the API applies the organization's leave-year policy.
  // Sending the calendar year here made merely opening the page provision a
  // whole extra year of balances for everyone in scope.
  const yearParam = params.get('year');
  const year = yearParam ? Number(yearParam) : undefined;
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<LeaveBalance | null>(null);

  const types = useQuery({
    queryKey: ['leave', 'types', params.page, params.search],
    queryFn: () => leaveApi.types({ page: params.page, limit: 10, search: params.search }),
  });

  const balances = useQuery({
    queryKey: ['leave', 'balances', 'all', year, params.page],
    queryFn: () => leaveApi.balances({ year, page: params.page, limit: 10 }),
  });

  const typeForm = useForm<TypeValues>({ resolver: zodResolver(leaveTypeCreateSchema) });
  const adjustForm = useForm<AdjustValues>({ resolver: zodResolver(leaveBalanceAdjustSchema) });

  const saveType = useApiMutation({
    mutationFn: (input: TypeValues) => {
      const parsed = leaveTypeCreateSchema.parse(input);
      return editing === 'new'
        ? leaveApi.createType(parsed)
        : leaveApi.updateType((editing as LeaveType).id, parsed);
    },
    invalidate: [['leave']],
    success: () => (editing === 'new' ? 'Leave type created' : 'Leave type updated'),
    error: 'Could not save',
    onSuccess: () => {
      setEditing(null);
    },
  });

  const removeType = useApiMutation({
    mutationFn: leaveApi.removeType,
    invalidate: [['leave']],
    success: 'Leave type deleted',
    error: 'Could not delete',
  });

  const adjust = useApiMutation({
    mutationFn: (input: AdjustValues) =>
      leaveApi.adjustBalance(leaveBalanceAdjustSchema.parse(input)),
    invalidate: [['leave']],
    success: 'Balance updated',
    error: 'Could not adjust',
    onSuccess: () => {
      setAdjusting(null);
    },
  });

  const openNewType = () => {
    typeForm.reset({
      name: '',
      code: '',
      daysPerYear: 12,
      isPaid: true,
      carryForward: false,
      maxCarryForward: null,
      requiresApproval: true,
      encashable: false,
    });
    setEditing('new');
  };

  const openEditType = (t: LeaveType) => {
    typeForm.reset({
      name: t.name,
      code: t.code,
      daysPerYear: t.daysPerYear,
      isPaid: t.isPaid,
      carryForward: t.carryForward,
      maxCarryForward: t.maxCarryForward,
      requiresApproval: t.requiresApproval,
      encashable: t.encashable,
    });
    setEditing(t);
  };

  const openAdjust = (b: LeaveBalance) => {
    adjustForm.reset({
      employeeId: b.employee?.id ?? '',
      leaveTypeId: b.leaveTypeId,
      year: b.year,
      allocated: b.allocated,
      carriedOver: b.carriedOver,
      note: '',
    });
    setAdjusting(b);
  };

  return (
    <Stagger className="space-y-6">
      <FadeInItem className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-lg">Leave types</h2>
            <p className="text-muted-foreground text-sm">
              Annual entitlement, carry-forward rules and approval requirement
            </p>
          </div>
          <Button onClick={openNewType}>Add leave type</Button>
        </div>

        <DataTable
          columns={[
            {
              key: 'name',
              header: 'Name',
              sortable: true,
              render: (t) => (
                <span className="font-medium">
                  {t.name} <span className="font-mono text-muted-foreground text-xs">{t.code}</span>
                </span>
              ),
            },
            {
              key: 'daysPerYear',
              header: 'Days/year',
              sortable: true,
              render: (t) => <span className="tabular-nums">{t.daysPerYear}</span>,
            },
            {
              key: 'rules',
              header: 'Rules',
              className: 'hidden sm:table-cell',
              render: (t) => (
                <span className="flex flex-wrap gap-1">
                  <Badge variant="secondary">{t.isPaid ? 'Paid' : 'Unpaid'}</Badge>
                  {t.carryForward && (
                    <Badge variant="outline">Carry ≤ {t.maxCarryForward ?? '—'}</Badge>
                  )}
                  {t.encashable && <Badge variant="outline">Encashable</Badge>}
                  {!t.requiresApproval && <Badge variant="outline">Auto-approve</Badge>}
                </span>
              ),
            },
          ]}
          rows={types.data?.data}
          rowKey={(t) => t.id}
          loading={types.isLoading}
          error={types.isError}
          onRetry={() => types.refetch()}
          sort={params.sort}
          order={params.order}
          onSortChange={params.toggleSort}
          meta={types.data?.meta}
          onPageChange={params.setPage}
          emptyTitle="No leave types yet"
          emptyHint="Casual, Sick, Earned…"
          actions={(t) => (
            <RowActions
              name={t.name}
              editPerm="leave.manage"
              onEdit={() => openEditType(t)}
              onDelete={() => removeType.mutate(t.id)}
              deleting={removeType.isPending}
            />
          )}
        />
      </FadeInItem>

      <FadeInItem className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-lg">Balances · {year}</h2>
            <p className="text-muted-foreground text-sm">
              Allocations are created automatically; adjust them here
            </p>
          </div>
          <Input
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => params.setFilter('year', e.target.value)}
            className="w-28"
            aria-label="Balance year"
          />
        </div>

        <DataTable
          columns={[
            {
              key: 'employee',
              header: 'Employee',
              render: (b) => (
                <span className="font-medium">
                  {b.employee?.firstName} {b.employee?.lastName}
                </span>
              ),
            },
            { key: 'type', header: 'Type', render: (b) => b.leaveType?.name ?? '—' },
            {
              key: 'allocated',
              header: 'Allocated',
              className: 'hidden sm:table-cell',
              render: (b) => <span className="tabular-nums">{b.allocated}</span>,
            },
            {
              key: 'used',
              header: 'Used',
              render: (b) => <span className="tabular-nums">{b.used}</span>,
            },
            {
              key: 'available',
              header: 'Available',
              render: (b) => <span className="font-medium tabular-nums">{b.available}</span>,
            },
          ]}
          rows={balances.data?.data}
          rowKey={(b) => b.id}
          loading={balances.isLoading}
          error={balances.isError}
          onRetry={() => balances.refetch()}
          meta={balances.data?.meta}
          onPageChange={params.setPage}
          emptyTitle="No balances for this year"
          actions={(b) => (
            <IconAction
              label="Adjust balance"
              icon={Pencil}
              size="icon"
              onClick={() => openAdjust(b)}
            />
          )}
        />
      </FadeInItem>

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'Add leave type' : 'Edit leave type'}
        onSubmit={typeForm.handleSubmit((v) => saveType.mutate(v))}
        submitting={saveType.isPending}
        submitLabel={editing === 'new' ? 'Create' : 'Save'}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormInput control={typeForm.control} name="name" label="Name" autoFocus />
          <FormInput control={typeForm.control} name="code" label="Code" placeholder="CL" />
        </div>
        <FormInput
          control={typeForm.control}
          name="daysPerYear"
          label="Days per year"
          type="number"
          step="0.5"
          min={0}
        />
        <div className="space-y-2.5">
          <FormCheckbox
            control={typeForm.control}
            name="isPaid"
            label="Paid leave"
            onValueChange={(checked) => {
              // Encashing leave that is not paid in the first place is
              // nonsense, and the schema refuses it. Clearing it here means
              // unchecking Paid does not strand an error on a field the user
              // never touched.
              if (!checked) typeForm.setValue('encashable', false, { shouldDirty: true });
            }}
          />
          <FormCheckbox
            control={typeForm.control}
            name="requiresApproval"
            label="Requires approval"
          />
          <FormCheckbox
            control={typeForm.control}
            name="carryForward"
            label="Allow carry-forward"
            onValueChange={(checked) => {
              // The cap field unmounts when this is off, so a stale value would
              // sit in state where nobody can see or clear it — and the schema
              // refuses a cap on a feature that is switched off.
              if (!checked) typeForm.setValue('maxCarryForward', null, { shouldDirty: true });
            }}
          />
        </div>
        {typeForm.watch('isPaid') && (
          <FormCheckbox
            control={typeForm.control}
            name="encashable"
            label="Encash unused balance on exit"
            hint="Whatever is left is paid out in the leaver's full & final settlement."
          />
        )}
        {typeForm.watch('carryForward') && (
          <FormInput
            control={typeForm.control}
            name="maxCarryForward"
            label="Maximum carried forward"
            type="number"
            step="0.5"
            min={0}
          />
        )}
      </FormDialog>

      <FormDialog
        open={adjusting !== null}
        onOpenChange={(open) => !open && setAdjusting(null)}
        title="Adjust balance"
        description={
          adjusting
            ? `${adjusting.employee?.firstName} ${adjusting.employee?.lastName} · ${adjusting.leaveType?.name} · ${adjusting.year}`
            : undefined
        }
        onSubmit={adjustForm.handleSubmit((v) => adjust.mutate(v))}
        submitting={adjust.isPending}
        submitLabel="Save balance"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormInput
            control={adjustForm.control}
            name="allocated"
            label="Allocated"
            type="number"
            step="0.5"
            min={0}
          />
          <FormInput
            control={adjustForm.control}
            name="carriedOver"
            label="Carried over"
            type="number"
            step="0.5"
            min={0}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {adjusting?.used ?? 0} day(s) are already booked and cannot be reduced below.
        </p>
      </FormDialog>
    </Stagger>
  );
}

export default function LeaveSettingsPage() {
  return (
    <Suspense>
      <LeaveSettingsView />
    </Suspense>
  );
}
