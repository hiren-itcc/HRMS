'use client';

import {
  IMPORT_MODE_LABELS,
  IMPORT_MODES,
  type ImportMode,
  type ImportPreview,
  type ImportResult,
  MAX_INVITES_PER_IMPORT,
} from '@hrms/shared';
import { Alert } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import { Checkbox } from '@hrms/ui/components/checkbox';
import { Input } from '@hrms/ui/components/input';
import { ArrowLeft, Download, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { employeeImportApi } from '@/features/employees/import-api';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * Upload → preview → confirm, in one route rather than a wizard framework.
 *
 * The preview is the whole safety story: nothing is written until it comes back
 * clean, so the confirm step cannot half-import a file full of typos.
 */
export default function EmployeeImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('RECORDS');
  const [sendInvites, setSendInvites] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const upload = useApiMutation({
    mutationFn: () => employeeImportApi.preview(file as File, mode),
    invalidate: [],
    onSuccess: (data) => {
      setPreview(data as ImportPreview);
      setResult(null);
    },
  });

  const commit = useApiMutation({
    mutationFn: () => employeeImportApi.commit(preview?.id as string, sendInvites),
    invalidate: [['employees']],
    success: 'Import finished',
    onSuccess: (data) => setResult(data as ImportResult),
  });

  const blocked = (preview?.errorCount ?? 0) > 0 || (preview?.fatal.length ?? 0) > 0;
  const tooManyInvites = mode === 'INVITE' && (preview?.rowCount ?? 0) > MAX_INVITES_PER_IMPORT;

  return (
    <div className="max-w-4xl space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/employees" />}>
        <ArrowLeft className="size-4" aria-hidden /> Back to employees
      </Button>

      <PageHeader
        title="Import employees"
        description="Load people from a spreadsheet — checked before anything is written"
      />

      <section className="space-y-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-sm">1 · The file</h2>
          <Button
            variant="outline"
            size="sm"
            render={<a href="/api/v1/employees/import/template" />}
          >
            <Download className="size-4" aria-hidden /> Download the template
          </Button>
        </div>

        <Input
          type="file"
          accept=".csv,text/csv"
          aria-label="Spreadsheet to import"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setResult(null);
          }}
        />
        <p className="text-muted-foreground text-sm">
          CSV only. Export offers Excel, but reading it back is not supported — save as CSV first.
        </p>

        <fieldset className="space-y-1.5">
          <legend className="font-medium text-sm">What kind of import is this?</legend>
          {IMPORT_MODES.map((option) => (
            <label key={option} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="import-mode"
                value={option}
                checked={mode === option}
                onChange={() => {
                  setMode(option);
                  setSendInvites(false);
                  setPreview(null);
                }}
                className="mt-1 size-4"
              />
              <span>{IMPORT_MODE_LABELS[option]}</span>
            </label>
          ))}
        </fieldset>

        <Button disabled={!file || upload.isPending} onClick={() => upload.mutate(undefined)}>
          <Upload className="size-4" aria-hidden /> Check the file
        </Button>
      </section>

      {preview && (
        <section className="space-y-4 rounded-xl border p-4">
          <h2 className="font-medium text-sm">2 · What it found</h2>

          {preview.fatal.length > 0 ? (
            /* File-level refusals. Nothing was parsed past these, so there are
               no per-row results to show and pretending otherwise would be
               noise. */
            <Alert variant="warning">
              <ul className="list-disc space-y-1 pl-5">
                {preview.fatal.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <>
              <p className="text-sm tabular-nums">
                {preview.rowCount} rows · {preview.readyCount} ready · {preview.errorCount} with
                problems
              </p>

              {preview.errorCount > 0 && (
                /* Errors first and sorted by row, because the next thing
                   somebody does is open the file and go to that line. */
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="p-2 text-left">Row</th>
                        <th className="p-2 text-left">Who</th>
                        <th className="p-2 text-left">Column</th>
                        <th className="p-2 text-left">Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows
                        .filter((row) => row.problems.length > 0)
                        .flatMap((row) =>
                          row.problems.map((problem) => (
                            <tr
                              key={`${row.row}-${problem.column}-${problem.message}`}
                              className="border-t"
                            >
                              <td className="p-2 tabular-nums">{row.row}</td>
                              <td className="p-2">{row.name || row.workEmail || '—'}</td>
                              <td className="p-2">{problem.column}</td>
                              <td className="p-2">{problem.message}</td>
                            </tr>
                          )),
                        )}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.rows.some((row) => row.managerDeferred) && (
                <p className="text-muted-foreground text-sm">
                  Some managers appear further down this file. They are linked once everybody
                  exists, which is normal when importing an organisation top-down.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {preview && !blocked && (
        <section className="space-y-4 rounded-xl border p-4">
          <h2 className="font-medium text-sm">3 · Import them</h2>

          {mode === 'INVITE' && (
            /* The count is in the label, not in a generic sentence. There is no
               undo for a sent invitation, so the number somebody is agreeing to
               has to be the thing they read. */
            <div className="flex items-start gap-2 text-sm">
              <Checkbox
                id="send-invites"
                checked={sendInvites}
                onCheckedChange={(value) => setSendInvites(value === true)}
                disabled={tooManyInvites}
              />
              <label htmlFor="send-invites">
                Send an invitation email to all {preview.readyCount} people. This cannot be undone.
              </label>
            </div>
          )}

          {tooManyInvites && (
            <Alert variant="warning">
              That would email {preview.rowCount} people at once and the limit is{' '}
              {MAX_INVITES_PER_IMPORT}. Split the file.
            </Alert>
          )}

          <Button
            disabled={commit.isPending || tooManyInvites}
            onClick={() => commit.mutate(undefined)}
          >
            Import {preview.readyCount} {preview.readyCount === 1 ? 'person' : 'people'}
          </Button>
        </section>
      )}

      {result && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-medium text-sm">Done</h2>
          <p className="text-sm tabular-nums">
            {result.createdCount} created · {result.failedCount} failed
            {result.invitedCount > 0 ? ` · ${result.invitedCount} invited` : ''}
          </p>
          {result.failedCount > 0 && (
            <ul className="space-y-1 text-sm">
              {result.rows
                .filter((row) => row.status === 'FAILED')
                .map((row) => (
                  <li key={row.row}>
                    Row {row.row} · {row.workEmail} — {row.message}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
