'use client';

import { Alert } from '@hrms/ui/components/alert';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { MonthPicker } from '@hrms/ui/components/month-picker';
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
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { useSession } from '@/components/session-provider';
import {
  FILING_LABELS,
  type FilingKind,
  filingKeys,
  filingsApi,
} from '@/features/payroll/filings-api';
import { useApiMutation } from '@/hooks/use-crud';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function lastMonth(): string {
  const now = new Date();
  const then = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${then.getFullYear()}-${String(then.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Statutory returns.
 *
 * Two things are on this screen that are not on any other payroll one: a
 * readiness gate that fires before a month can be chosen, and an exclusion
 * panel that is deliberately louder than the success count. A short file
 * nobody noticed is the failure this whole design is arranged to prevent.
 */
export default function FilingsPage() {
  const { can } = useSession();
  const [kind, setKind] = useState<FilingKind>('ECR');
  const [month, setMonth] = useState(lastMonth);

  const readiness = useQuery({
    queryKey: filingKeys.readiness(),
    queryFn: () => filingsApi.readiness(),
  });
  const history = useQuery({ queryKey: filingKeys.list(), queryFn: () => filingsApi.list() });
  const preview = useQuery({
    queryKey: filingKeys.preview(kind, month),
    queryFn: () => filingsApi.preview(kind, month),
    // A month with no published run is a 404, and retrying it is noise.
    retry: false,
  });

  const generate = useApiMutation({
    mutationFn: () => filingsApi.generate(kind, month),
    invalidate: [filingKeys.all()],
    success: 'Return generated',
  });

  const blocked = readiness.data?.[kind] ?? null;

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title="Statutory returns"
        description="Monthly files for the EPFO and ESIC portals"
      />

      {/*
        Said before a month can be picked, not at download time. By then the
        operator has chosen a period, read the exclusions and believed the
        numbers — the worst possible moment to discover the file is unusable.
      */}
      {blocked && (
        <Alert variant="warning">
          {blocked}{' '}
          {can('settings.manage') && (
            <Link href="/settings/preferences" className="underline">
              Open Settings
            </Link>
          )}
        </Alert>
      )}

      {/*
        Beta, and it stays beta until a portal has actually accepted one. The
        golden-file tests are the strongest check available in CI and they are
        not the same thing as an upload succeeding.
      */}
      <Alert variant="info">
        These files have not yet been accepted by a portal in this deployment. Check the first one
        against the EPFO or ESIC validator before relying on it.
      </Alert>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <span className="font-medium text-sm">Return</span>
          <Select value={kind} onValueChange={(v) => setKind(v as FilingKind)}>
            <SelectTrigger className="w-80" aria-label="Which return">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FILING_LABELS) as FilingKind[]).map((option) => (
                <SelectItem key={option} value={option}>
                  {FILING_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="font-medium text-sm">Month</span>
          <MonthPicker id="filing-month" value={month} onValueChange={setMonth} />
        </div>
      </div>

      {preview.isError && (
        <Alert variant="warning">
          There is no published payroll run for {month}. A return has to be filed against figures
          that cannot change afterwards.
        </Alert>
      )}

      {preview.data && (
        <section className="space-y-4 rounded-xl border p-4">
          <p className="text-sm tabular-nums">
            {preview.data.rowCount} {preview.data.rowCount === 1 ? 'member' : 'members'} would be
            filed
          </p>

          {/*
            The exclusions are the point of this panel, so they are rendered
            before the totals and never collapsed. Somebody left out for want of
            a UAN is a person whose contribution is not reaching their account.
          */}
          {preview.data.excluded.length > 0 && (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
              <p className="flex items-center gap-2 font-medium text-sm">
                <FileWarning className="size-4" aria-hidden />
                {preview.data.excluded.length} left out of this return
              </p>
              <ul className="space-y-1 text-sm">
                {preview.data.excluded.map((person) => (
                  <li key={person.employeeCode}>
                    {person.employeeName} ({person.employeeCode}) — {person.reason}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">
                They are left out rather than filed with the field blank: a file with a hole in it
                is discovered by the portal rather than by us.
              </p>
            </div>
          )}

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
              disabled={!!blocked || generate.isPending || preview.data.rowCount === 0}
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
            {(history.data ?? []).map((filing) => (
              <li key={filing.id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <span className="font-medium text-sm">
                    {filing.kind === 'ECR' ? 'ECR' : 'ESIC return'} · {filing.period}
                  </span>
                  <span className="block text-muted-foreground text-xs tabular-nums">
                    {filing.rowCount} filed
                    {filing.excludedCount > 0 ? ` · ${filing.excludedCount} left out` : ''} ·
                    generated {dateFmt.format(new Date(filing.generatedAt))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {filing.excludedCount > 0 && (
                    <Badge className="border-transparent bg-warning/15 text-warning-text">
                      {filing.excludedCount} excluded
                    </Badge>
                  )}
                  {can('payroll.filing') && (
                    <Button
                      size="sm"
                      variant="outline"
                      render={<a href={`/api/v1/payroll/filings/${filing.id}/file`} />}
                    >
                      <Download className="size-4" aria-hidden /> Download
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
