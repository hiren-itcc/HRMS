'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { leaveBalanceAdjustSchema, leaveTypeCreateSchema } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Checkbox } from '@hrms/ui/components/checkbox';
import { Input } from '@hrms/ui/components/input';
import { Label } from '@hrms/ui/components/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Suspense, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { DataTable } from '@/components/data-table';
import { FadeInItem, Stagger } from '@/components/motion';
import { Field } from '@/features/auth/components/field';
import { type LeaveBalance, type LeaveType, leaveApi } from '@/features/leave/api';
import { useListParams } from '@/hooks/use-list-params';
import { ApiError } from '@/lib/api-client';

type TypeValues = z.input<typeof leaveTypeCreateSchema>;
type AdjustValues = z.input<typeof leaveBalanceAdjustSchema>;

function LeaveSettingsView() {
  const queryClient = useQueryClient();
  const params = useListParams('name');
  // Left undefined so the API applies the organization's leave-year policy.
  // Sending the calendar year here made merely opening the page provision a
  // whole extra year of balances for everyone in scope.
  const yearParam = params.get('year');
  const year = yearParam ? Number(yearParam) : undefined;
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<LeaveBalance | null>(null);
  const carryId = useId();
  const paidId = useId();
  const approvalId = useId();

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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['leave'] });

  const saveType = useMutation({
    mutationFn: (input: TypeValues) => {
      const parsed = leaveTypeCreateSchema.parse(input);
      return editing === 'new'
        ? leaveApi.createType(parsed)
        : leaveApi.updateType((editing as LeaveType).id, parsed);
    },
    onSuccess: () => {
      invalidate();
      toast.success(editing === 'new' ? 'Leave type created' : 'Leave type updated');
      setEditing(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save'),
  });

  const removeType = useMutation({
    mutationFn: leaveApi.removeType,
    onSuccess: () => {
      invalidate();
      toast.success('Leave type deleted');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not delete'),
  });

  const adjust = useMutation({
    mutationFn: (input: AdjustValues) =>
      leaveApi.adjustBalance(leaveBalanceAdjustSchema.parse(input)),
    onSuccess: () => {
      invalidate();
      toast.success('Balance updated');
      setAdjusting(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not adjust'),
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
            <Button
              variant="ghost"
              size="icon"
              aria-label="Adjust balance"
              onClick={() => openAdjust(b)}
            >
              <Pencil className="size-4" aria-hidden />
            </Button>
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
          <Field label="Name" error={typeForm.formState.errors.name?.message}>
            {(a11y) => <Input {...a11y} autoFocus {...typeForm.register('name')} />}
          </Field>
          <Field label="Code" error={typeForm.formState.errors.code?.message}>
            {(a11y) => <Input {...a11y} placeholder="CL" {...typeForm.register('code')} />}
          </Field>
        </div>
        <Field label="Days per year" error={typeForm.formState.errors.daysPerYear?.message}>
          {(a11y) => (
            <Input
              {...a11y}
              type="number"
              step="0.5"
              min={0}
              {...typeForm.register('daysPerYear')}
            />
          )}
        </Field>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Checkbox
              id={paidId}
              checked={typeForm.watch('isPaid') ?? true}
              onCheckedChange={(v) => typeForm.setValue('isPaid', v === true)}
            />
            <Label htmlFor={paidId} className="font-normal">
              Paid leave
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={approvalId}
              checked={typeForm.watch('requiresApproval') ?? true}
              onCheckedChange={(v) => typeForm.setValue('requiresApproval', v === true)}
            />
            <Label htmlFor={approvalId} className="font-normal">
              Requires approval
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={carryId}
              checked={typeForm.watch('carryForward') ?? false}
              onCheckedChange={(v) => {
                typeForm.setValue('carryForward', v === true);
                if (v !== true) typeForm.setValue('maxCarryForward', null);
              }}
            />
            <Label htmlFor={carryId} className="font-normal">
              Allow carry-forward
            </Label>
          </div>
        </div>
        {typeForm.watch('carryForward') && (
          <Field
            label="Maximum carried forward"
            error={typeForm.formState.errors.maxCarryForward?.message}
          >
            {(a11y) => (
              <Input
                {...a11y}
                type="number"
                step="0.5"
                min={0}
                {...typeForm.register('maxCarryForward')}
              />
            )}
          </Field>
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
          <Field label="Allocated" error={adjustForm.formState.errors.allocated?.message}>
            {(a11y) => (
              <Input
                {...a11y}
                type="number"
                step="0.5"
                min={0}
                {...adjustForm.register('allocated')}
              />
            )}
          </Field>
          <Field label="Carried over" error={adjustForm.formState.errors.carriedOver?.message}>
            {(a11y) => (
              <Input
                {...a11y}
                type="number"
                step="0.5"
                min={0}
                {...adjustForm.register('carriedOver')}
              />
            )}
          </Field>
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
