'use client';

import {
  COMPONENT_CODES,
  PAY_COMPONENT_KINDS,
  type PayComponentCreateInput,
  payComponentCreateSchema,
} from '@hrms/shared';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { SelectItem } from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { type Column, DataTable } from '@/components/data-table';
import { FormCheckbox, FormInput, FormSelect } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { payrollApi, payrollKeys } from '@/features/payroll/api';
import type { ComponentKind, PayComponent } from '@/features/payroll/types';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

const BLANK: PayComponentCreateInput = {
  code: '',
  name: '',
  kind: 'EARNING',
  taxable: true,
  isStatutory: false,
  order: 0,
  active: true,
};

const KIND_LABELS: Record<ComponentKind, string> = {
  EARNING: 'Earning',
  DEDUCTION: 'Deduction',
  EMPLOYER_CONTRIBUTION: 'Employer contribution',
};

/**
 * The codes the calculation engine hardcodes — mirrors `PROTECTED_CODES` in
 * `apps/api/src/modules/payroll/pay-components.guardrails.ts`. That module is
 * the authority; this is just the same set read from the shared constant it
 * is itself built from, so the two cannot drift.
 */
const PROTECTED_CODES: ReadonlySet<string> = new Set(Object.values(COMPONENT_CODES));

function isProtected(code: string): boolean {
  return PROTECTED_CODES.has(code);
}

/**
 * The pay component catalogue: the lines a payslip can pay out on.
 *
 * Modelled on `expenses/categories/page.tsx` — closest field mix, and the
 * only category screen that already handles an in-use delete refusal. Two
 * rules this screen exists to express, both enforced server-side and only
 * *explained* here: `code` cannot change after creation (the engine looks
 * components up by it), and a component whose code the engine hardcodes
 * (`COMPONENT_CODES`) cannot have its `kind`, `taxable` or `isStatutory`
 * changed, or be deleted — only deactivated.
 */
export default function PayComponentsPage() {
  const { can } = useSession();
  const canManage = can('payroll.structure.manage');
  const [editing, setEditing] = useState<PayComponent | 'new' | null>(null);

  const query = useQuery({
    // A manager needs the inactive rows to reactivate them; anyone else sees
    // exactly the active-only catalogue every other reader already gets —
    // the same split `expenses/categories/page.tsx` makes.
    queryKey: canManage ? payrollKeys.allComponents() : payrollKeys.components(),
    queryFn: () => payrollApi.components(canManage),
  });

  const form = useZodForm<PayComponentCreateInput>(payComponentCreateSchema, {
    defaultValues: BLANK,
  });

  const editingRow = editing !== 'new' ? editing : null;
  const protectedComponent = editingRow !== null && isProtected(editingRow.code);

  const invalidate = [payrollKeys.components()];

  const save = useApiMutation({
    mutationFn: (input: PayComponentCreateInput) => {
      if (editingRow) {
        // `code` is immutable after creation — the update schema has no
        // `code` field at all, so it is dropped here rather than sent and
        // silently ignored by the API.
        const { code: _code, ...patch } = input;
        return payrollApi.updateComponent(editingRow.id, patch);
      }
      return payrollApi.createComponent(input);
    },
    invalidate,
    success: 'Component saved',
    onSuccess: () => setEditing(null),
  });

  // Delete refusals — protected component, or one still referenced by a
  // structure, adjustment or expense category — arrive as a ready-made
  // sentence from the API (`pay-components.guardrails.ts`). `useApiMutation`
  // already renders an `ApiError`'s message verbatim as the toast, so no
  // bespoke `onError` is added here.
  const remove = useApiMutation({
    mutationFn: (id: string) => payrollApi.deleteComponent(id),
    invalidate,
    success: 'Component removed',
  });

  const columns: Column<PayComponent>[] = [
    {
      key: 'name',
      header: 'Component',
      alwaysVisible: true,
      render: (row) => (
        <span className="flex items-center gap-2">
          {row.name}
          {!row.active && <Badge variant="outline">Inactive</Badge>}
          {isProtected(row.code) && (
            <Badge variant="outline" className="gap-1">
              <ShieldAlert className="size-3" aria-hidden />
              Protected
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      render: (row) => <span className="font-mono text-xs">{row.code}</span>,
    },
    {
      key: 'kind',
      header: 'Kind',
      render: (row) => KIND_LABELS[row.kind],
    },
    {
      key: 'taxable',
      header: 'Taxable',
      render: (row) => (row.taxable ? 'Yes' : 'No'),
    },
    {
      key: 'isStatutory',
      header: 'Statutory',
      render: (row) => (row.isStatutory ? 'Yes' : 'No'),
    },
    {
      key: 'order',
      header: 'Order',
      className: 'tabular-nums',
      render: (row) => row.order,
    },
  ];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              form.reset(BLANK);
              setEditing('new');
            }}
          >
            <Plus className="size-4" aria-hidden /> Add a component
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="No pay components yet"
        emptyHint="A component is the line a payslip pays out on — earnings, deductions and employer contributions all start here."
        actions={
          canManage
            ? (row) => (
                <RowActions
                  name={row.name}
                  editPerm="payroll.structure.manage"
                  deleting={remove.isPending}
                  onEdit={() => {
                    form.reset({
                      code: row.code,
                      name: row.name,
                      kind: row.kind,
                      taxable: row.taxable,
                      isStatutory: row.isStatutory,
                      order: row.order,
                      active: row.active,
                    });
                    setEditing(row);
                  }}
                  onDelete={() => remove.mutate(row.id)}
                />
              )
            : undefined
        }
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'Add a component' : 'Edit the component'}
        submitting={save.isPending}
        submitLabel="Save"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        {protectedComponent && editingRow && (
          <Alert variant="warning">
            <ShieldAlert aria-hidden />
            <AlertTitle>{editingRow.code} is a core payroll component</AlertTitle>
            <AlertDescription>
              The calculation engine looks it up by code and hardcodes what it means, so kind,
              taxable and statutory cannot be changed here and it cannot be deleted — only name and
              catalogue order are editable. Deactivate it instead if it should stop being used.
            </AlertDescription>
          </Alert>
        )}

        <FormInput
          control={form.control}
          name="name"
          label="Name"
          placeholder="Special Allowance"
          required
        />
        <FormInput
          control={form.control}
          name="code"
          label="Code"
          placeholder="SPECIAL"
          disabled={editingRow !== null}
          hint={
            editingRow
              ? 'Locked. The payroll engine looks this component up by code — renaming it would silently zero every payslip line, structure line and statutory figure that references it.'
              : 'Capitals, digits and underscores. Permanent once saved, for the same reason.'
          }
          required
        />
        <FormSelect
          control={form.control}
          name="kind"
          label="Kind"
          placeholder="Choose a kind"
          disabled={protectedComponent}
          required
        >
          {PAY_COMPONENT_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </SelectItem>
          ))}
        </FormSelect>
        <FormCheckbox
          control={form.control}
          name="taxable"
          label="Counts toward taxable income"
          disabled={protectedComponent}
        />
        <FormCheckbox
          control={form.control}
          name="isStatutory"
          label="Computed by the statutory engine, not a structure line"
          disabled={protectedComponent}
        />
        <FormInput
          control={form.control}
          name="order"
          label="Order"
          type="number"
          step="1"
          min={0}
          hint="Sorts this catalogue only, not a payslip — payslip lines follow a salary structure's own order plus a few fixed slots, so reordering this list will not reorder a payslip."
        />
        <FormCheckbox
          control={form.control}
          name="active"
          label="Available for new structures and claims"
          hint="Turning this off is the safe delete — existing structures, adjustments and payslips keep pointing at it, and a component still in use cannot be deleted outright."
        />
      </FormDialog>
    </div>
  );
}
