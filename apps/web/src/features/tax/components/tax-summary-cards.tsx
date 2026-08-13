'use client';

import { TAX_DECLARATION_STATUS_LABELS, type TaxDeclarationStatusCode } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Card, CardContent } from '@hrms/ui/components/card';
import { cn } from '@hrms/ui/lib/utils';
import { formatMoney } from '@/features/payroll/api';
import type { AnnualTax, TaxSummary } from '../api';

const STATUS_TONE: Record<TaxDeclarationStatusCode, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SUBMITTED: 'bg-info/15 text-info-text',
  APPROVED: 'bg-success/15 text-success-text',
  REJECTED: 'bg-destructive/15 text-destructive-text',
};

export function DeclarationStatusBadge({ status }: { status: TaxDeclarationStatusCode }) {
  return (
    <Badge className={cn('border-transparent', STATUS_TONE[status])}>
      {TAX_DECLARATION_STATUS_LABELS[status]}
    </Badge>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
        <p className="font-semibold text-xl tabular-nums">{value}</p>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * The six figures that answer "why is this much coming out of my pay".
 *
 * Deducted, remaining and this month are shown together on purpose: the
 * divisor is the whole story, and a monthly figure on its own reads as
 * arbitrary. The remaining-months count is stated rather than implied.
 */
export function TaxSummaryCards({ summary }: { summary: TaxSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Figure
        label="Projected annual income"
        value={formatMoney(summary.annual.projectedAnnualIncome)}
        hint="Earned so far, plus what this salary projects for the rest of the year"
      />
      <Figure
        label="Estimated taxable income"
        value={formatMoney(summary.annual.projectedTaxableIncome)}
        hint="After exemptions, the standard deduction and approved declarations"
      />
      <Figure
        label="Estimated annual tax"
        value={formatMoney(summary.annual.annualTaxLiability)}
        hint="Slabs, rebate, surcharge and cess"
      />
      <Figure label="Tax already deducted" value={formatMoney(summary.alreadyDeducted)} />
      <Figure label="Remaining tax" value={formatMoney(summary.remainingTax)} />
      <Figure
        label="This month’s TDS"
        value={formatMoney(summary.monthlyTds)}
        hint={
          summary.override
            ? `Overridden — ${summary.override.reason}`
            : `Remaining tax over ${summary.remainingMonths} payroll ${summary.remainingMonths === 1 ? 'month' : 'months'} left this year`
        }
      />
    </div>
  );
}

/**
 * The slab-by-slab working.
 *
 * Shown because "why that number" is the question, and a single annual figure
 * cannot answer it. Bands with no income in them are already absent — the
 * engine only returns the ones that were used.
 */
export function TaxWorking({ annual }: { annual: AnnualTax }) {
  const rows: { label: string; value: number; muted?: boolean }[] = [
    { label: 'Projected gross', value: annual.projectedAnnualIncome },
    { label: 'Exemptions (HRA and similar)', value: -annual.exemptions, muted: true },
    { label: 'Standard deduction', value: -annual.standardDeduction, muted: true },
    { label: 'Approved deductions', value: -annual.deductions, muted: true },
    { label: 'Taxable income', value: annual.projectedTaxableIncome },
  ];

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <caption className="sr-only">How taxable income was arrived at</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal">
                {row.label}
              </th>
              <td
                className={cn(
                  'py-1.5 text-right tabular-nums',
                  row.muted && 'text-muted-foreground',
                )}
              >
                {row.value === 0 ? '—' : formatMoney(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="w-full text-sm">
        <caption className="pb-2 text-left font-medium">Tax, band by band</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-1.5 text-left font-medium">
              Band
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Rate
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Income in band
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Tax
            </th>
          </tr>
        </thead>
        <tbody>
          {annual.slabs.map((slab) => (
            <tr key={`${slab.fromAmount}-${slab.rate}`} className="border-b last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal tabular-nums">
                {formatMoney(slab.fromAmount)} –{' '}
                {slab.toAmount === null ? 'above' : formatMoney(slab.toAmount)}
              </th>
              <td className="py-1.5 text-right tabular-nums">{slab.rate}%</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(slab.taxableInBand)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(slab.tax)}</td>
            </tr>
          ))}
          {annual.slabs.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-center text-muted-foreground">
                Taxable income is below the first slab, so no tax is due.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3} className="py-1.5 text-right font-normal">
              Income tax
            </th>
            <td className="py-1.5 text-right tabular-nums">{formatMoney(annual.incomeTax)}</td>
          </tr>
          {annual.rebate > 0 && (
            <tr>
              <th scope="row" colSpan={3} className="py-1.5 text-right font-normal">
                Less rebate (s.87A)
              </th>
              <td className="py-1.5 text-right tabular-nums">−{formatMoney(annual.rebate)}</td>
            </tr>
          )}
          {annual.surcharge > 0 && (
            <tr>
              <th scope="row" colSpan={3} className="py-1.5 text-right font-normal">
                Surcharge, after marginal relief
              </th>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(annual.surcharge)}</td>
            </tr>
          )}
          <tr>
            <th scope="row" colSpan={3} className="py-1.5 text-right font-normal">
              Health and education cess
            </th>
            <td className="py-1.5 text-right tabular-nums">{formatMoney(annual.cess)}</td>
          </tr>
          <tr className="border-t font-semibold">
            <th scope="row" colSpan={3} className="py-1.5 text-right">
              Annual tax liability
            </th>
            <td className="py-1.5 text-right tabular-nums">
              {formatMoney(annual.annualTaxLiability)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** What was actually deducted, month by month. Frozen payslip lines, not a forecast. */
export function TdsHistory({ history }: { history: { month: string; tds: number }[] }) {
  const total = history.reduce((sum, row) => sum + row.tds, 0);
  if (history.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing has been deducted this financial year yet.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">TDS deducted each month this financial year</caption>
      <tbody>
        {history.map((row) => (
          <tr key={row.month} className="border-b last:border-0">
            <th scope="row" className="py-1.5 text-left font-normal tabular-nums">
              {row.month}
            </th>
            <td className="py-1.5 text-right tabular-nums">{formatMoney(row.tds)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t font-semibold">
          <th scope="row" className="py-1.5 text-left">
            Total deducted
          </th>
          <td className="py-1.5 text-right tabular-nums">{formatMoney(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
