'use client';

import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Textarea } from '@hrms/ui/components/textarea';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatMoney } from '@/features/payroll/api';
import { currentMonth, financialYearOf, taxApi, taxKeys } from '@/features/tax/api';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * Declarations waiting on HR.
 *
 * Each row shows declared beside eligible, because the gap between them is the
 * thing HR is actually agreeing: somebody who declared ₹2,00,000 of 80C is
 * approved for ₹1,50,000 and the screen should not make that look like a
 * mistake.
 */
export default function TaxApprovalsPage() {
  const month = currentMonth();
  const financialYear = financialYearOf(month);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const query = useQuery({
    queryKey: taxKeys.pending(financialYear),
    queryFn: () => taxApi.pending(financialYear),
  });

  const invalidate = [taxKeys.all()];
  const close = () => {
    setReviewing(null);
    setNote('');
  };

  const approve = useApiMutation({
    mutationFn: (employeeId: string) =>
      taxApi.approve(employeeId, financialYear, note.trim() ? { note: note.trim() } : {}),
    invalidate,
    success: 'Declaration approved — future TDS recalculated',
    onSuccess: close,
  });

  const reject = useApiMutation({
    mutationFn: (employeeId: string) =>
      taxApi.reject(employeeId, financialYear, { note: note.trim() }),
    invalidate,
    success: 'Sent back',
    onSuccess: close,
  });

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Approving recalculates what this person’s remaining payroll months will deduct. Nothing
        already paid is changed.
      </p>

      {query.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}

      {!query.isPending && rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="font-medium">Nothing waiting</p>
            <p className="text-muted-foreground text-sm">
              Declarations submitted for FY {financialYear} appear here until you respond.
            </p>
          </CardContent>
        </Card>
      )}

      {rows.map((row) => (
        <Card key={row.id}>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>
              {row.employee.firstName} {row.employee.lastName}{' '}
              <span className="font-mono font-normal text-muted-foreground text-xs">
                {row.employee.employeeCode}
              </span>
            </CardTitle>
            <span className="text-muted-foreground text-xs">
              Submitted {row.submittedAt?.slice(0, 10) ?? '—'}
              {row.revision > 1 ? ` · revision ${row.revision}` : ''}
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
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
                    Limit
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Will count
                  </th>
                </tr>
              </thead>
              <tbody>
                {row.items.map((item) => (
                  <tr key={item.section} className="border-b last:border-0">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {item.section}
                    </th>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatMoney(item.declaredAmount)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {item.statutoryLimit === null ? 'none' : formatMoney(item.statutoryLimit)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatMoney(item.eligibleAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {row.annualRentPaid !== null && (
              <p className="text-muted-foreground text-sm">
                Rent {formatMoney(row.annualRentPaid)} · {row.metroCity ? 'metro' : 'non-metro'}.
                The HRA exemption is computed from this and their structure.
              </p>
            )}

            {reviewing === row.employeeId ? (
              <div className="space-y-2">
                <label htmlFor={`note-${row.id}`} className="font-medium text-sm">
                  Note
                </label>
                <Textarea
                  id={`note-${row.id}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Required when sending it back — say which proof is missing."
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  {/* Disabled without a note: the API refuses it anyway, and a
                      refusal you could have been shown first is a wasted trip. */}
                  <Button
                    variant="outline"
                    disabled={reject.isPending || !note.trim()}
                    onClick={() => reject.mutate(row.employeeId)}
                  >
                    Send it back
                  </Button>
                  <Button
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(row.employeeId)}
                  >
                    Approve
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setReviewing(row.employeeId);
                    setNote('');
                  }}
                >
                  Review
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
