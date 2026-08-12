'use client';

import { Alert } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Download, FileWarning } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state';
import { useSession } from '@/components/session-provider';
import {
  financialYearOf,
  QUARTER_LABELS,
  QUARTERS,
  type Quarter,
  tdsApi,
  tdsKeys,
} from '@/features/payroll/tds-api';
import { useApiMutation } from '@/hooks/use-crud';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** The financial years worth offering: this one and the two before it. */
function recentYears(): string[] {
  const now = new Date();
  const current = financialYearOf(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const start = Number(current.slice(0, 4));
  return [0, 1, 2].map(
    (back) => `${start - back}-${String((start - back + 1) % 100).padStart(2, '0')}`,
  );
}

/**
 * Form 24Q.
 *
 * The readiness gate fires before a quarter can be generated, and refuses on a
 * reconciliation difference rather than warning about it: a 24Q reports both
 * the challan total and the deductee total, and if those disagree the return is
 * wrong whichever one you believe.
 *
 * A missing PAN is the one problem that warns instead. A return can legitimately
 * be filed for a deductee whose PAN is unavailable, and refusing would stop the
 * company meeting a statutory deadline over a data-quality problem.
 */
export default function Form24QPage() {
  const { can } = useSession();
  const years = recentYears();
  const [fy, setFy] = useState(years[0] as string);
  const [quarter, setQuarter] = useState<Quarter>('Q1');
  const [downloading, setDownloading] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: tdsKeys.preview(fy, quarter),
    queryFn: () => tdsApi.preview(fy, quarter),
    retry: false,
  });
  const history = useQuery({ queryKey: tdsKeys.returns(), queryFn: () => tdsApi.returns() });

  const generate = useApiMutation({
    mutationFn: () => tdsApi.generate(fy, quarter),
    invalidate: [tdsKeys.all()],
    success: 'Return generated and frozen',
  });

  async function download(id: string, name: string) {
    setDownloading(id);
    try {
      const blob = await tdsApi.download(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed', { description: 'Please try again in a moment.' });
    } finally {
      setDownloading(null);
    }
  }

  const blocked = preview.data?.blocked ?? null;
  const layoutBlocked = preview.data?.layoutBlocked ?? null;

  return (
    <div className="max-w-4xl space-y-5">
      {/*
        This file is the FVU's input, not a filed return — ADR-001. Saying so
        here is the whole basis on which the module was built, so it is
        unconditional and sits above the pickers rather than beside the button.
      */}
      <Alert variant="info">
        This produces the text file you load into the NSDL File Validation Utility. Run it through
        the FVU before filing — nothing here has been accepted by a portal, and a golden-file test
        is not the same thing as an upload succeeding.
      </Alert>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <span className="font-medium text-sm">Financial year</span>
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="w-44" aria-label="Financial year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="font-medium text-sm">Quarter</span>
          <Select value={quarter} onValueChange={(v) => setQuarter(v as Quarter)}>
            <SelectTrigger className="w-48" aria-label="Quarter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUARTERS.map((option) => (
                <SelectItem key={option} value={option}>
                  {QUARTER_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {quarter === 'Q4' && (
        <Alert variant="warning">
          Q4 also needs Annexure II, the annual salary annexure, which this does not yet produce.
          The file below covers Annexure I only.
        </Alert>
      )}

      {layoutBlocked && (
        <Alert variant="warning">
          {layoutBlocked} Everything below still reflects this quarter's real figures — if it
          reconciles now, it will still reconcile when the layout lands.
        </Alert>
      )}

      {blocked && (
        <Alert variant="warning">
          {blocked}{' '}
          {can('settings.manage') && (
            <Link href="/settings/preferences" className="underline">
              Open Settings
            </Link>
          )}{' '}
          <Link href="/payroll/filings/challans" className="underline">
            Open the challan register
          </Link>
        </Alert>
      )}

      {preview.data && !blocked && (
        <section className="space-y-4 rounded-xl border p-4">
          <p className="text-sm tabular-nums">
            {preview.data.rowCount} deductee {preview.data.rowCount === 1 ? 'record' : 'records'}{' '}
            across {preview.data.months.join(', ')}
          </p>

          {preview.data.warnings.map((warning) => (
            <div
              key={warning}
              className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3"
            >
              <p className="flex items-center gap-2 font-medium text-sm">
                <FileWarning className="size-4" aria-hidden />
                {warning}
              </p>
            </div>
          ))}

          <dl className="grid gap-2 sm:grid-cols-3">
            {Object.entries(preview.data.totals).map(([key, value]) => (
              <div key={key}>
                <dt className="text-muted-foreground text-xs">{key}</dt>
                <dd className="tabular-nums">{value.toLocaleString('en-IN')}</dd>
              </div>
            ))}
          </dl>

          {can('payroll.filing') && (
            <Button
              disabled={!!layoutBlocked || generate.isPending || preview.data.rowCount === 0}
              onClick={() => generate.mutate(undefined)}
            >
              Generate and freeze this return
            </Button>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-medium text-sm">Generated</h2>
        {history.data && history.data.length === 0 ? (
          <EmptyState
            title="Nothing generated yet"
            hint="A return is frozen when you generate it, so what you download later is exactly what you filed."
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {(history.data ?? []).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <span className="font-medium text-sm">
                    24Q · {row.financialYear} {row.quarter}
                  </span>
                  <span className="block text-muted-foreground text-xs tabular-nums">
                    {row.rowCount} deductees
                    {row.excludedCount > 0 ? ` · ${row.excludedCount} without a PAN` : ''} ·
                    generated {dateFmt.format(new Date(row.generatedAt))}
                  </span>
                </div>
                {can('payroll.filing') && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={downloading === row.id}
                    onClick={() =>
                      download(row.id, `form24q-${row.financialYear}-${row.quarter}.txt`)
                    }
                  >
                    <Download className="size-4" aria-hidden /> Download
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
