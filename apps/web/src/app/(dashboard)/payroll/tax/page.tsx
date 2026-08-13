'use client';

import {
  TAX_REGIME_LABELS,
  type TaxDeclarationInput,
  type TaxRegimeCode,
  type TaxSectionCode,
} from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from '@/components/session-provider';
import { formatMoney } from '@/features/payroll/api';
import {
  currentMonth,
  type DeductionRule,
  financialYearOf,
  taxApi,
  taxKeys,
} from '@/features/tax/api';
import {
  DeclarationStatusBadge,
  TaxSummaryCards,
  TaxWorking,
  TdsHistory,
} from '@/features/tax/components/tax-summary-cards';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * My income tax.
 *
 * The whole employee journey on one page: pick a regime, and — only if it is
 * the Old one — say what you invested. Everything else is computed and shown
 * rather than asked for.
 */
export default function MyTaxPage() {
  const { can } = useSession();
  const month = currentMonth();
  const financialYear = financialYearOf(month);

  const summary = useQuery({
    queryKey: taxKeys.me(financialYear, month),
    queryFn: () => taxApi.me(financialYear, month),
    retry: false,
  });

  const declaration = useQuery({
    queryKey: taxKeys.myDeclaration(financialYear),
    queryFn: () => taxApi.myDeclaration(financialYear),
  });

  const config = useQuery({
    queryKey: taxKeys.configuration(financialYear),
    queryFn: () => taxApi.configuration(financialYear),
  });

  const regime = summary.data?.regime ?? 'NEW';
  /*
   * A configuration whose slabs were not taken from the Finance Act says so in
   * its `source`, and this is where that reaches a human. A placeholder nobody
   * can see is a placeholder everybody is taxed by — the seed leans on this
   * banner as its only safety mechanism, so it renders above everything else
   * and is not dismissible.
   */
  const activeConfig = config.data?.find((row) => row.regime === regime);
  const placeholderSource = activeConfig?.source?.startsWith('PLACEHOLDER')
    ? activeConfig.source
    : null;
  const oldConfig = config.data?.find((row) => row.regime === 'OLD');
  const rules: DeductionRule[] = oldConfig?.deductionRules ?? [];

  const invalidate = [taxKeys.all()];

  const setRegime = useApiMutation({
    mutationFn: (next: TaxRegimeCode) => taxApi.setRegime(financialYear, next),
    invalidate,
    success: 'Regime saved',
  });

  // Declaration form state. A plain record keyed by section rather than
  // react-hook-form: the field set is generated from configuration rows, and a
  // form library buys nothing for a variable list of numbers validated as a
  // whole on the server.
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [rent, setRent] = useState('');
  const [metro, setMetro] = useState(false);

  useEffect(() => {
    const current = declaration.data;
    setAmounts(
      Object.fromEntries(
        (current?.items ?? []).map((item) => [item.section, String(item.declaredAmount)]),
      ),
    );
    setRent(current?.annualRentPaid ? String(current.annualRentPaid) : '');
    setMetro(current?.metroCity ?? false);
  }, [declaration.data]);

  const declarationPayload = (): TaxDeclarationInput => ({
    financialYear,
    annualRentPaid: rent.trim() === '' ? null : Number(rent),
    metroCity: metro,
    items: Object.entries(amounts)
      .filter(([, value]) => value.trim() !== '' && Number(value) > 0)
      .map(([section, value]) => ({
        section: section as TaxSectionCode,
        declaredAmount: Number(value),
      })),
  });

  const save = useApiMutation({
    mutationFn: () => taxApi.saveDeclaration(declarationPayload()),
    invalidate,
    success: 'Declaration saved',
  });

  const submit = useApiMutation({
    mutationFn: async () => {
      await taxApi.saveDeclaration(declarationPayload());
      return taxApi.submitDeclaration(financialYear);
    },
    invalidate,
    success: 'Sent to HR',
  });

  const status = declaration.data?.status ?? null;
  const editable = status === null || status === 'DRAFT' || status === 'REJECTED';
  const busy = save.isPending || submit.isPending || setRegime.isPending;

  // The year has no confirmed slabs. Say so plainly rather than rendering
  // zeros, which would read as "no tax due".
  const unconfigured = summary.isError;

  return (
    <div className="space-y-4">
      {can('payroll.tax.view') && (
        <div className="flex flex-wrap justify-end gap-2">
          <Link
            href="/payroll/tax/employees"
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
          >
            Everyone’s tax
          </Link>
          {can('payroll.tax.declaration.approve') && (
            <Link
              href="/payroll/tax/approvals"
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
            >
              Declarations to review
            </Link>
          )}
        </div>
      )}

      {placeholderSource && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <span className="font-medium">These tax rates are placeholders.</span> {placeholderSource}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Income tax regime · FY {financialYear}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(['NEW', 'OLD'] as const).map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-primary"
            >
              <input
                type="radio"
                name="regime"
                className="mt-1"
                checked={regime === option}
                disabled={busy}
                onChange={() => setRegime.mutate(option)}
              />
              <span>
                <span className="block font-medium">{TAX_REGIME_LABELS[option]}</span>
                <span className="block text-muted-foreground text-sm">
                  {option === 'NEW'
                    ? 'Default. No declaration needed — your tax is worked out from your salary.'
                    : 'I want to claim eligible deductions and exemptions.'}
                </span>
              </span>
            </label>
          ))}
          <p className="text-muted-foreground text-xs">
            Each financial year is chosen fresh. Last year’s choice does not carry over.
          </p>
        </CardContent>
      </Card>

      {unconfigured ? (
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="font-medium">
              Tax rules for FY {financialYear} have not been entered yet.
            </p>
            <p className="text-muted-foreground">
              Your projection will appear once somebody records this year’s slabs from the Finance
              Act. No TDS is being deducted in the meantime — this is not the same as having no tax
              to pay.
            </p>
          </CardContent>
        </Card>
      ) : (
        summary.data && (
          <>
            <TaxSummaryCards summary={summary.data} />

            <Card>
              <CardHeader>
                <CardTitle>How that was worked out</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <TaxWorking annual={summary.data.annual} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Deducted so far</CardTitle>
              </CardHeader>
              <CardContent>
                <TdsHistory history={summary.data.history} />
              </CardContent>
            </Card>
          </>
        )
      )}

      {regime === 'NEW' ? (
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="font-medium">No declaration is required.</p>
            <p className="text-muted-foreground">
              Your income tax is calculated automatically from your projected taxable salary, and
              deducted across the payroll months left in the year.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Declaration · FY {financialYear}</CardTitle>
            {status && <DeclarationStatusBadge status={status} />}
          </CardHeader>
          <CardContent className="space-y-4">
            {status === 'REJECTED' && declaration.data?.decisionNote && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <span className="font-medium">Sent back:</span> {declaration.data.decisionNote}
              </p>
            )}
            {status === 'SUBMITTED' && (
              <p className="text-muted-foreground text-sm">
                This is with HR. You can edit it again once they respond.
              </p>
            )}

            <div className="space-y-3">
              {rules.map((rule) => {
                const declared = Number(amounts[rule.section] ?? 0);
                const over = rule.maxAmount !== null && declared > rule.maxAmount;
                return (
                  <div key={rule.section} className="space-y-1">
                    <label htmlFor={rule.section} className="font-medium text-sm">
                      {rule.label}
                    </label>
                    <Input
                      id={rule.section}
                      type="number"
                      min="0"
                      step="1"
                      className="tabular-nums"
                      disabled={!editable || busy}
                      value={amounts[rule.section] ?? ''}
                      onChange={(event) =>
                        setAmounts((previous) => ({
                          ...previous,
                          [rule.section]: event.target.value,
                        }))
                      }
                    />
                    <p className="text-muted-foreground text-xs">
                      {rule.hint ? `${rule.hint} ` : ''}
                      {rule.maxAmount === null
                        ? 'No ceiling.'
                        : `Up to ${formatMoney(rule.maxAmount)} counts.`}
                      {/* Declaring above the cap is allowed and capped on the way
                          through — saying so up front stops it looking like a bug. */}
                      {over &&
                        ` You have entered more; ${formatMoney(rule.maxAmount ?? 0)} will count.`}
                    </p>
                  </div>
                );
              })}

              <div className="space-y-1">
                <label htmlFor="rent" className="font-medium text-sm">
                  Annual rent paid
                </label>
                <Input
                  id="rent"
                  type="number"
                  min="0"
                  className="tabular-nums"
                  disabled={!editable || busy}
                  value={rent}
                  onChange={(event) => setRent(event.target.value)}
                />
                <label className="flex items-center gap-2 text-muted-foreground text-xs">
                  <input
                    type="checkbox"
                    checked={metro}
                    disabled={!editable || busy}
                    onChange={(event) => setMetro(event.target.checked)}
                  />
                  I live in a metro city (Delhi, Mumbai, Kolkata or Chennai)
                </label>
                <p className="text-muted-foreground text-xs">
                  The HRA exemption is worked out from this, your basic and the HRA in your
                  structure — it is the least of three figures, so it is not something to type in.
                </p>
              </div>
            </div>

            {editable && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={() => save.mutate(undefined)}>
                  Save draft
                </Button>
                <Button disabled={busy} onClick={() => submit.mutate(undefined)}>
                  Submit to HR
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
