'use client';

import { type TdsChallanCreateInput, tdsChallanCreateSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { type Column, DataTable } from '@/components/data-table';
import { FormInput } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { formatTdsMoney, type TdsChallan, tdsApi, tdsKeys } from '@/features/payroll/tds-api';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

const BLANK: TdsChallanCreateInput = {
  period: '',
  bsrCode: '',
  challanSerial: '',
  depositDate: '',
  sectionCode: '92B',
  minorHead: '200',
  tds: 0,
  surcharge: 0,
  educationCess: 0,
  interest: 0,
  fee: 0,
  penalty: 0,
  others: 0,
};

/**
 * The TDS challan register.
 *
 * One challan per month, which the API enforces with a unique constraint. That
 * is what lets a 24Q name the challan every deductee was paid under without an
 * allocation screen.
 *
 * `period` is the payroll month the deposit *covers*, not the month it was
 * paid in — a July deduction deposited on 7 August is 2026-07. The field hint
 * says so, because getting it backwards files everybody under the wrong
 * challan and the portal cannot tell.
 */
export default function TdsChallansPage() {
  const { can } = useSession();
  const canManage = can('payroll.filing');
  const [editing, setEditing] = useState<TdsChallan | 'new' | null>(null);

  const query = useQuery({ queryKey: tdsKeys.challans(), queryFn: () => tdsApi.challans() });

  const form = useZodForm<TdsChallanCreateInput>(tdsChallanCreateSchema, {
    defaultValues: BLANK,
  });

  const invalidate = [tdsKeys.all()];

  const save = useApiMutation({
    mutationFn: (values: TdsChallanCreateInput) =>
      editing && editing !== 'new'
        ? tdsApi.updateChallan(editing.id, values)
        : tdsApi.createChallan(values),
    invalidate,
    success: 'Challan saved',
    onSuccess: () => setEditing(null),
  });

  const remove = useApiMutation({
    mutationFn: (id: string) => tdsApi.removeChallan(id),
    invalidate,
    success: 'Challan removed',
  });

  const columns: Column<TdsChallan>[] = [
    { key: 'period', header: 'For month', alwaysVisible: true, render: (row) => row.period },
    {
      key: 'bsr',
      header: 'BSR code',
      render: (row) => <span className="font-mono text-xs">{row.bsrCode}</span>,
    },
    {
      key: 'serial',
      header: 'Serial',
      render: (row) => <span className="font-mono text-xs">{row.challanSerial}</span>,
    },
    { key: 'deposited', header: 'Deposited', render: (row) => row.depositDate },
    {
      key: 'tds',
      header: 'TDS',
      render: (row) => <span className="tabular-nums">{formatTdsMoney(row.tds)}</span>,
    },
    {
      key: 'total',
      header: 'Total paid',
      render: (row) => <span className="tabular-nums">{formatTdsMoney(row.total)}</span>,
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
            <Plus className="size-4" aria-hidden /> Record a deposit
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
        emptyTitle="No challans recorded"
        emptyHint="A Form 24Q names the challan each deductee was paid under, so record every TDS deposit here as you make it."
        actions={
          canManage
            ? (row) => (
                <RowActions
                  name={`the ${row.period} challan`}
                  editPerm="payroll.filing"
                  deleting={remove.isPending}
                  onEdit={() => {
                    form.reset({
                      period: row.period,
                      bsrCode: row.bsrCode,
                      challanSerial: row.challanSerial,
                      depositDate: row.depositDate,
                      sectionCode: row.sectionCode,
                      minorHead: row.minorHead,
                      tds: row.tds,
                      surcharge: row.surcharge,
                      educationCess: row.educationCess,
                      interest: row.interest,
                      fee: row.fee,
                      penalty: row.penalty,
                      others: row.others,
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
        title={editing === 'new' ? 'Record a deposit' : 'Correct the challan'}
        submitting={save.isPending}
        submitLabel="Save"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <FormInput
          control={form.control}
          name="period"
          label="Payroll month"
          placeholder="2026-07"
          hint="The month the TDS was deducted, not the month you paid it. July's deduction deposited in August is 2026-07."
          required
        />
        <FormInput
          control={form.control}
          name="bsrCode"
          label="BSR code"
          placeholder="0510308"
          hint="Seven digits, from the bank's challan counterfoil."
          required
        />
        <FormInput
          control={form.control}
          name="challanSerial"
          label="Challan serial"
          placeholder="00123"
          required
        />
        <FormInput
          control={form.control}
          name="depositDate"
          label="Deposited on"
          type="date"
          required
        />
        <FormInput
          control={form.control}
          name="tds"
          label="TDS"
          type="number"
          step="0.01"
          hint="Must equal the TDS on that month's payslips, to the paisa, or the quarter cannot be filed."
          required
        />
        <FormInput
          control={form.control}
          name="interest"
          label="Interest"
          type="number"
          step="0.01"
        />
        <FormInput
          control={form.control}
          name="fee"
          label="Late-filing fee (s.234E)"
          type="number"
          step="0.01"
        />
      </FormDialog>
    </div>
  );
}
