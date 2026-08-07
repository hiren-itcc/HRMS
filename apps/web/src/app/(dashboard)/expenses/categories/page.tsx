'use client';

import { type ExpenseCategoryCreateInput, expenseCategoryCreateSchema } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { SelectItem } from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { type Column, DataTable } from '@/components/data-table';
import { FormCheckbox, FormInput, FormSelect } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { type ExpenseCategory, expenseKeys, expensesApi } from '@/features/expenses/api';
import { formatMoney, payrollApi } from '@/features/payroll/api';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

const BLANK: ExpenseCategoryCreateInput = {
  code: '',
  name: '',
  capPerClaim: null,
  requiresReceipt: true,
  componentId: '',
  active: true,
  order: 0,
};

/**
 * What can be claimed for, and which payslip line it pays out on.
 *
 * Lives beside the claims rather than under Settings because that is where
 * `/assets/categories` lives and the two are the same kind of thing — a small
 * list the module cannot work without, maintained by whoever runs the module.
 */
export default function ExpenseCategoriesPage() {
  const { can } = useSession();
  const canManage = can('expense.manage');
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);

  const query = useQuery({
    queryKey: canManage ? expenseKeys.allCategories() : expenseKeys.categories(),
    // Somebody who can only claim sees the list they can claim against;
    // whoever maintains it needs the deactivated ones too.
    queryFn: () => (canManage ? expensesApi.allCategories() : expensesApi.categories()),
  });

  /*
   * Only earnings and deductions can carry a claim, and never a statutory one —
   * PF is computed from settings, and a hand-entered PF line would disagree
   * with the rules that produced it. The API refuses both again; filtering here
   * is what stops somebody choosing one and then being told no.
   */
  const components = useQuery({
    queryKey: ['payroll', 'components'],
    queryFn: () => payrollApi.components(),
    select: (rows) =>
      rows.filter(
        (row) => !row.isStatutory && (row.kind === 'EARNING' || row.kind === 'DEDUCTION'),
      ),
  });

  const form = useZodForm<ExpenseCategoryCreateInput>(expenseCategoryCreateSchema, {
    defaultValues: BLANK,
  });

  const invalidate = [expenseKeys.all()];

  const save = useApiMutation({
    mutationFn: (input: ExpenseCategoryCreateInput) =>
      editing && editing !== 'new'
        ? expensesApi.updateCategory(editing.id, input)
        : expensesApi.createCategory(input),
    invalidate,
    success: 'Category saved',
    onSuccess: () => setEditing(null),
  });

  const remove = useApiMutation({
    mutationFn: (id: string) => expensesApi.removeCategory(id),
    invalidate,
    success: 'Category removed',
  });

  const columns: Column<ExpenseCategory>[] = [
    {
      key: 'name',
      header: 'Category',
      alwaysVisible: true,
      render: (row) => (
        <span className="flex items-center gap-2">
          {row.name}
          {!row.active && <Badge variant="outline">Inactive</Badge>}
        </span>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      render: (row) => <span className="font-mono text-xs">{row.code}</span>,
    },
    {
      key: 'cap',
      header: 'Cap per claim',
      // Null is no ceiling, and saying "—" is clearer than printing ₹0.00,
      // which reads as "nothing may be claimed".
      render: (row) => (
        <span className="tabular-nums">
          {row.capPerClaim === null ? '—' : formatMoney(row.capPerClaim)}
        </span>
      ),
    },
    {
      key: 'receipt',
      header: 'Receipt',
      render: (row) => (row.requiresReceipt ? 'Required' : 'Optional'),
    },
    {
      key: 'component',
      header: 'Pays out on',
      render: (row) => row.component?.name ?? '—',
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
            <Plus className="size-4" aria-hidden /> Add a category
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
        emptyTitle="No expense categories yet"
        emptyHint="A claim has to be filed under one, so add the kinds of thing people spend on."
        actions={
          canManage
            ? (row) => (
                <RowActions
                  name={row.name}
                  editPerm="expense.manage"
                  deleting={remove.isPending}
                  onEdit={() => {
                    form.reset({
                      code: row.code,
                      name: row.name,
                      capPerClaim: row.capPerClaim,
                      requiresReceipt: row.requiresReceipt,
                      componentId: row.componentId,
                      active: row.active,
                      order: row.order,
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
        title={editing === 'new' ? 'Add a category' : 'Edit the category'}
        submitting={save.isPending}
        submitLabel="Save"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <FormInput control={form.control} name="name" label="Name" placeholder="Travel" required />
        <FormInput
          control={form.control}
          name="code"
          label="Code"
          placeholder="TRAVEL"
          hint="Capitals, numbers and underscores."
          required
        />
        <FormSelect
          control={form.control}
          name="componentId"
          label="Pays out on"
          placeholder="Choose a payslip line"
          hint="Which line an approved claim appears on. Statutory components cannot be claimed against."
          busy={components.isPending}
          required
        >
          {(components.data ?? []).map((component) => (
            <SelectItem key={component.id} value={component.id}>
              {component.name}
            </SelectItem>
          ))}
        </FormSelect>
        <FormInput
          control={form.control}
          name="capPerClaim"
          label="Cap per claim"
          type="number"
          step="0.01"
          placeholder="Leave blank for no limit"
          hint="Checked against the category's total across the whole claim, not line by line."
        />
        <FormCheckbox
          control={form.control}
          name="requiresReceipt"
          label="Require a receipt on every line"
        />
        <FormCheckbox
          control={form.control}
          name="active"
          label="Available for new claims"
          hint="Turning this off leaves existing claims saying what they were for."
        />
      </FormDialog>
    </div>
  );
}
