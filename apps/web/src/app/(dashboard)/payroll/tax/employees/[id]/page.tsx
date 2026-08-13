'use client';

import { TAX_REGIME_LABELS } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { Textarea } from '@hrms/ui/components/textarea';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/components/session-provider';
import { formatMoney } from '@/features/payroll/api';
import { currentMonth, financialYearOf, taxApi, taxKeys } from '@/features/tax/api';
import {
  DeclarationStatusBadge,
  TaxSummaryCards,
  TaxWorking,
  TdsHistory,
} from '@/features/tax/components/tax-summary-cards';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * One person's tax, in enough detail for HR to answer "why that number".
 *
 * The working is the point of this screen. A payroll operator who cannot
 * explain a deduction to the person it came out of has to guess, and guessing
 * about somebody's tax is how a correction becomes a complaint.
 */
export default function EmployeeTaxDetailPage() {
  const params = useParams<{ id: string }>();
  const employeeId = params.id;
  const { can } = useSession();
  const month = currentMonth();
  const financialYear = financialYearOf(month);

  const summary = useQuery({
    queryKey: taxKeys.employee(employeeId, financialYear, month),
    queryFn: () => taxApi.employee(employeeId, financialYear, month),
    retry: false,
  });

  const declaration = useQuery({
    queryKey: taxKeys.employeeDeclaration(employeeId, financialYear),
    queryFn: () => taxApi.employeeDeclaration(employeeId, financialYear),
  });

  const [overrideAmount, setOverrideAmount] = useState('');
  const [reason, setReason] = useState('');

  const invalidate = [taxKeys.all()];

  const override = useApiMutation({
    mutationFn: () =>
      taxApi.override(employeeId, {
        month,
        overrideTds: Number(overrideAmount),
        reason: reason.trim(),
      }),
    invalidate,
    success: 'Override saved',
    onSuccess: () => {
      setOverrideAmount('');
      setReason('');
    },
  });

  const clear = useApiMutation({
    mutationFn: () => taxApi.clearOverride(employeeId, month),
    invalidate,
    success: 'Back to the calculated figure',
  });

  if (summary.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm">
          <p className="font-medium">FY {financialYear} has no confirmed tax rules.</p>
          <p className="text-muted-foreground">
            Nothing can be projected for this person until this year’s slabs are recorded.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {summary.data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">{TAX_REGIME_LABELS[summary.data.regime]}</Badge>
            <span className="text-muted-foreground text-sm">FY {financialYear}</span>
            {summary.data.declarationStatus && (
              <DeclarationStatusBadge status={summary.data.declarationStatus} />
            )}
          </div>

          <TaxSummaryCards summary={summary.data} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Tax calculation</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <TaxWorking annual={summary.data.annual} />
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>TDS history</CardTitle>
                </CardHeader>
                <CardContent>
                  <TdsHistory history={summary.data.history} />
                </CardContent>
              </Card>

              {declaration.data && (
                <Card>
                  <CardHeader>
                    <CardTitle>Declaration</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th scope="col" className="py-1.5 text-left font-medium">
                            Section
                          </th>
                          <th scope="col" className="py-1.5 text-right font-medium">
                            Declared
                          </th>
                          <th scope="col" className="py-1.5 text-right font-medium">
                            Eligible
                          </th>
                          <th scope="col" className="py-1.5 text-right font-medium">
                            Approved
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {declaration.data.items.map((item) => (
                          <tr key={item.section} className="border-b last:border-0">
                            <th scope="row" className="py-1.5 text-left font-normal">
                              {item.section}
                            </th>
                            <td className="py-1.5 text-right tabular-nums">
                              {formatMoney(item.declaredAmount)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                              {formatMoney(item.eligibleAmount)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {formatMoney(item.approvedAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {declaration.data.annualRentPaid !== null && (
                      <p className="pt-2 text-muted-foreground text-xs">
                        Rent {formatMoney(declaration.data.annualRentPaid)} ·{' '}
                        {declaration.data.metroCity ? 'metro' : 'non-metro'}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {can('payroll.tax.manage') && (
            <Card>
              <CardHeader>
                <CardTitle>Override this month</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  {/* Not the normal workflow, and the screen should say so. */}
                  An exception, not part of the normal run. The calculated figure is kept beside
                  yours so the difference stays auditable.
                </p>
                {summary.data.override ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
                    <span>
                      Overridden to{' '}
                      <span className="tabular-nums">
                        {formatMoney(summary.data.override.overrideTds)}
                      </span>{' '}
                      — {summary.data.override.reason}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={clear.isPending}
                      onClick={() => clear.mutate(undefined)}
                    >
                      Use the calculated figure
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <label htmlFor="override" className="font-medium text-sm">
                        TDS for {month}
                      </label>
                      <Input
                        id="override"
                        type="number"
                        min="0"
                        className="tabular-nums"
                        value={overrideAmount}
                        onChange={(event) => setOverrideAmount(event.target.value)}
                      />
                    </div>
                    <div className="min-w-64 flex-1 space-y-1">
                      <label htmlFor="reason" className="font-medium text-sm">
                        Reason
                      </label>
                      <Textarea
                        id="reason"
                        rows={1}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Additional voluntary deduction requested by the employee"
                      />
                    </div>
                    <Button
                      disabled={override.isPending || !overrideAmount.trim() || !reason.trim()}
                      onClick={() => override.mutate(undefined)}
                    >
                      Override
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
