'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { Field } from '@/components/field';
import { employeesApi } from '@/features/employees/api';
import { formatMoney, payrollApi, payrollKeys } from '@/features/payroll/api';
import { useApiMutation, useOptions } from '@/hooks/use-crud';

/**
 * One-off amounts for this month: bonuses, incentives, loan instalments.
 *
 * The calculation engine has accepted these since payroll shipped and there
 * was no way to enter one, so a bonus meant editing the salary structure and
 * remembering to undo it.
 *
 * Adjustments belong to the *month*, not the run — deleting and recalculating
 * a run keeps them. They only reach a payslip on the next calculate, which the
 * panel says out loud, because entering a bonus and seeing no change to the
 * totals is otherwise baffling.
 */
export function AdjustmentsPanel({
  month,
  editable,
}: {
  month: string;
  /** False once the run is locked or published — the API refuses it too. */
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [componentId, setComponentId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const list = useQuery({
    queryKey: payrollKeys.adjustments(month),
    queryFn: () => payrollApi.adjustments(month),
  });

  const components = useQuery({
    queryKey: ['payroll', 'components'],
    queryFn: payrollApi.components,
    enabled: open,
  });

  const employees = useOptions(
    'employees',
    employeesApi.options,
    (e) => `${e.firstName} ${e.lastName} · ${e.employeeCode}`,
    { enabled: open },
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: payrollKeys.adjustments(month) });
  };

  const save = useApiMutation({
    error: 'Could not save the adjustment',
    mutationFn: () =>
      payrollApi.setAdjustment({
        employeeId,
        month,
        componentId,
        amount: Number(amount),
        note: note.trim() || null,
      }),
    success: 'Saved — it applies the next time the run is calculated',
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setEmployeeId('');
      setComponentId('');
      setAmount('');
      setNote('');
    },
  });

  const remove = useApiMutation({
    mutationFn: (id: string) => payrollApi.deleteAdjustment(id),
    error: 'Could not remove the adjustment',
    success: 'Adjustment removed — recalculate to apply it',
    onSuccess: () => {
      invalidate();
    },
  });

  /*
   * Statutory components are computed from settings and employer-cost ones
   * never touch net pay, so neither can be adjusted. The API refuses both; the
   * picker simply does not offer them.
   */
  const componentOptions = (components.data ?? [])
    .filter((c) => !c.isStatutory && (c.kind === 'EARNING' || c.kind === 'DEDUCTION'))
    .map((c) => ({ value: c.id, label: `${c.name} (${c.kind === 'EARNING' ? '+' : '−'})` }));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Adjustments</CardTitle>
            <CardDescription>
              One-offs for this month only. They are not prorated — a bonus is a bonus however much
              of the month was worked — and they reach payslips on the next calculate.
            </CardDescription>
          </div>
          {editable && (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" aria-hidden /> Add
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : list.data?.length ? (
          <ul className="divide-y">
            {list.data.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {a.employee.firstName} {a.employee.lastName}
                    <span className="ml-1.5 text-muted-foreground text-xs">
                      {a.employee.employeeCode}
                    </span>
                  </p>
                  <p className="truncate text-muted-foreground text-xs">
                    {a.component.name}
                    {a.note && ` · ${a.note}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={a.component.kind === 'EARNING' ? 'success' : 'outline'}>
                    {a.component.kind === 'EARNING' ? '+' : '−'}
                    {formatMoney(a.amount)}
                  </Badge>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Remove ${a.component.name} for ${a.employee.firstName}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(a.id)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            Nothing this month. Bonuses, incentives and loan instalments go here rather than into a
            salary structure, which is what somebody earns every month.
          </p>
        )}
      </CardContent>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add an adjustment"
        description="Applies to this month only. Entering the same component for the same person again replaces the amount."
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        submitting={save.isPending}
        submitLabel="Save adjustment"
      >
        <Field label="Employee" required>
          {(a11y) => (
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger {...a11y}>
                <SelectValue placeholder="Choose an employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.options?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Component" required>
          {(a11y) => (
            <Select value={componentId} onValueChange={setComponentId}>
              <SelectTrigger {...a11y}>
                <SelectValue placeholder="Bonus, incentive, loan…" />
              </SelectTrigger>
              <SelectContent>
                {componentOptions.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field
          label="Amount"
          hint="Always positive — whether it adds or subtracts comes from the component"
        >
          {(a11y) => (
            <Input
              {...a11y}
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label="Note" hint="For whoever approves the run; the employee never sees it">
          {(a11y) => (
            <Input
              {...a11y}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
            />
          )}
        </Field>
      </FormDialog>
    </Card>
  );
}
