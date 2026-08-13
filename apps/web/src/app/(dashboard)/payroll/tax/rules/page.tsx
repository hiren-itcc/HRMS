'use client';

import {
  TAX_REGIME_LABELS,
  TAX_REGIMES,
  type TaxConfigurationSaveInput,
  type TaxRegimeCode,
} from '@hrms/shared';
import { Alert, AlertDescription } from '@hrms/ui/components/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@hrms/ui/components/alert-dialog';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Switch } from '@hrms/ui/components/switch';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import { formatMoney } from '@/features/payroll/api';
import { currentMonth, financialYearOf, taxApi, taxKeys } from '@/features/tax/api';
import { SlabEditor, type SlabRow } from '@/features/tax/components/slab-editor';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * The year's tax rules.
 *
 * The module was built configuration-driven so a Finance Act change would be an
 * edit rather than a release — and then shipped with no way to make the edit.
 * This is that screen.
 *
 * State is a local `draft` object with a JSON dirty check rather than
 * react-hook-form, following `settings/preferences/page.tsx` and for the reason
 * it gives: several independent sub-editors make "which part is dirty" the
 * awkward question, and a single form across all of them makes it harder.
 */

type Draft = Omit<TaxConfigurationSaveInput, 'slabs'> & { slabs: SlabRow[] };

function blankDraft(financialYear: string, regime: TaxRegimeCode): Draft {
  return {
    financialYear,
    regime,
    status: 'UNCONFIRMED',
    source: '',
    standardDeduction: 0,
    rebateIncomeLimit: null,
    rebateMaxAmount: null,
    cessRate: 0,
    marginalRelief: true,
    slabs: [],
    surchargeBands: [],
    deductionRules: [],
  };
}

function toNumber(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export default function TaxRulesPage() {
  const { can } = useSession();
  const month = currentMonth();
  const [financialYear, setFinancialYear] = useState(() => financialYearOf(month));
  const [regime, setRegime] = useState<TaxRegimeCode>('NEW');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);

  const configs = useQuery({
    queryKey: taxKeys.configuration(),
    queryFn: () => taxApi.configuration(),
    enabled: can('payroll.tax.manage'),
  });

  const impact = useQuery({
    queryKey: taxKeys.impact(financialYear),
    queryFn: () => taxApi.configurationImpact(financialYear),
    enabled: can('payroll.tax.manage'),
  });

  const years = [...new Set((configs.data ?? []).map((row) => row.financialYear))].sort().reverse();
  const server = (configs.data ?? []).find(
    (row) => row.financialYear === financialYear && row.regime === regime,
  );

  // Server state seeds the draft whenever the year, the regime, or a save
  // refetch changes it. Typing after that is local until Save.
  useEffect(() => {
    setDraft(
      server
        ? {
            financialYear: server.financialYear,
            regime: server.regime,
            status: server.status,
            source: server.source ?? '',
            standardDeduction: server.standardDeduction,
            rebateIncomeLimit: server.rebateIncomeLimit,
            rebateMaxAmount: server.rebateMaxAmount,
            cessRate: server.cessRate,
            marginalRelief: server.marginalRelief,
            slabs: server.slabs,
            surchargeBands: server.surchargeBands,
            deductionRules: server.deductionRules.map((rule) => ({
              section: rule.section,
              label: rule.label,
              hint: rule.hint,
              maxAmount: rule.maxAmount,
            })),
          }
        : blankDraft(financialYear, regime),
    );
  }, [server, financialYear, regime]);

  const save = useApiMutation({
    mutationFn: (input: Draft) => taxApi.saveConfiguration(input as TaxConfigurationSaveInput),
    invalidate: [taxKeys.all()],
    success: 'Tax rules saved',
    onSuccess: () => setConfirming(false),
  });

  if (!can('payroll.tax.manage')) return <NoAccess what="tax rules" />;

  const dirty =
    draft !== null &&
    JSON.stringify(draft) !== JSON.stringify(server ?? blankDraft(financialYear, regime));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));

  const placeholder = server?.source?.startsWith('PLACEHOLDER') ?? false;
  const affected = impact.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="fy" className="font-medium text-sm">
            Financial year
          </label>
          <Select value={financialYear} onValueChange={setFinancialYear}>
            <SelectTrigger className="w-36" id="fy" aria-label="Financial year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(years.length > 0 ? years : [financialYear]).map((year) => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="regime" className="font-medium text-sm">
            Regime
          </label>
          <Select value={regime} onValueChange={(v) => setRegime(v as TaxRegimeCode)}>
            <SelectTrigger className="w-44" id="regime" aria-label="Regime">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAX_REGIMES.map((option) => (
                <SelectItem key={option} value={option}>
                  {TAX_REGIME_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {server && (
          <Badge variant="outline" className="mb-2">
            {server.status === 'CONFIRMED' ? 'Confirmed' : 'Not confirmed'}
          </Badge>
        )}
      </div>

      {placeholder && (
        <Alert variant="warning">
          <AlertDescription>
            These rates are placeholders copied from another year, not the Finance Act. Replace them
            here and say where the real figures came from.
          </AlertDescription>
        </Alert>
      )}

      {draft && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Tax bands</CardTitle>
            </CardHeader>
            <CardContent>
              <SlabEditor
                items={draft.slabs}
                disabled={save.isPending}
                onChange={(slabs) => set('slabs', slabs)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Allowances and rates</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Standard deduction"
                value={draft.standardDeduction}
                onChange={(v) => set('standardDeduction', v ?? 0)}
                hint="Taken off salary income before the bands apply."
              />
              <Field
                label="Cess rate (%)"
                value={draft.cessRate}
                step="0.01"
                onChange={(v) => set('cessRate', v ?? 0)}
                hint="Charged on tax plus surcharge."
              />
              <Field
                label="Rebate income limit"
                value={draft.rebateIncomeLimit ?? null}
                nullable
                onChange={(v) => set('rebateIncomeLimit', v)}
                hint="s.87A. Blank means this regime has no rebate. It is a cliff, not a taper."
              />
              <Field
                label="Maximum rebate"
                value={draft.rebateMaxAmount ?? null}
                nullable
                onChange={(v) => set('rebateMaxAmount', v)}
              />
              <label className="flex items-center gap-2 text-sm sm:col-span-2" htmlFor="relief">
                <Switch
                  id="relief"
                  checked={draft.marginalRelief}
                  disabled={save.isPending}
                  onCheckedChange={(next) => set('marginalRelief', next === true)}
                />
                Apply surcharge marginal relief
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Where these figures came from</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                value={draft.source ?? ''}
                disabled={save.isPending}
                aria-label="Source"
                placeholder="Finance Act 2026, or your accountant’s note"
                onChange={(event) => set('source', event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Required to confirm a year. The first question anybody asks of a rate table is who
                said so, and the second is when — an unsourced table is one nobody can check.
              </p>
              <label className="flex items-center gap-2 pt-1 text-sm" htmlFor="confirmed">
                <Switch
                  id="confirmed"
                  checked={draft.status === 'CONFIRMED'}
                  disabled={save.isPending}
                  onCheckedChange={(next) =>
                    set('status', next === true ? 'CONFIRMED' : 'UNCONFIRMED')
                  }
                />
                Confirmed — payroll may deduct against these
              </label>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {affected && affected.publishedRuns > 0 && (
              <p className="text-muted-foreground text-sm">
                {affected.publishedRuns} published {affected.publishedRuns === 1 ? 'run' : 'runs'}{' '}
                this year · {formatMoney(affected.deductedSoFar)} already deducted
              </p>
            )}
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => {
                if (affected && affected.publishedRuns > 0) setConfirming(true);
                else save.mutate(draft);
              }}
            >
              Save rules
            </Button>
          </div>
        </>
      )}

      {/*
        The same bargain the payroll-rates dialog states, because it is the same
        one: an unpublished run re-prices on its next recalculation, and nothing
        already paid is rewritten.
      */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change the rules for {financialYear}?</AlertDialogTitle>
            <AlertDialogDescription>
              {affected?.publishedRuns} payroll{' '}
              {affected?.publishedRuns === 1 ? 'run has' : 'runs have'} already been published this
              year, deducting {formatMoney(affected?.deductedSoFar ?? 0)}. Those payslips keep the
              rates they were run with — nothing already paid is rewritten. What changes is
              everybody’s remaining months, which will adjust to true up the year against the new
              figures.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => draft && save.mutate(draft)}>
              Save rules
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  nullable,
  step,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  nullable?: boolean;
  step?: string;
}) {
  // Explicit htmlFor rather than wrapping: biome cannot see the native input
  // inside the design-system `Input`, and an association it cannot verify is
  // one a screen reader may not get either.
  const id = `field-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="font-medium text-sm">
        {label}
      </label>
      <div>
        <Input
          id={id}
          type="number"
          min="0"
          step={step}
          className="mt-1 tabular-nums"
          placeholder={nullable ? 'None' : undefined}
          value={value === null ? '' : String(value)}
          onChange={(event) =>
            onChange(
              nullable && event.target.value.trim() === '' ? null : toNumber(event.target.value),
            )
          }
        />
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}
