'use client';

import { Alert, AlertDescription } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { Plus, X } from 'lucide-react';
import { IconAction } from '@/components/icon-action';

/**
 * The progressive rate table for one regime, one year.
 *
 * Modelled on `pt-slab-editor.tsx`, which solves the same shape of problem for
 * professional tax: a controlled `{ items, disabled, onChange }` component that
 * sorts on read and on write, and offers **no reorder control** — a band's
 * position *is* its lower bound, so a move button would be an instruction the
 * engine ignores.
 *
 * The warnings here are soft and non-blocking, like that component's. The hard
 * refusal comes from the API on save (`tax-config.guardrails.ts`), which is the
 * authority; these exist so somebody sees the gap while they are still looking
 * at the row that caused it, rather than after pressing Save.
 */

export interface SlabRow {
  fromAmount: number;
  /** Null is the open-ended top band. Exactly one table may have it. */
  toAmount: number | null;
  rate: number;
}

const BLANK: SlabRow = { fromAmount: 0, toAmount: null, rate: 0 };

/** Empty or unparseable becomes zero, never the previous value. */
function toNumber(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function money(value: number): string {
  return value.toLocaleString('en-IN');
}

/**
 * The same checks the API enforces, run while typing.
 *
 * A gap is the one that matters: income falling between two bands is taxed by
 * no band at all, which produces a smaller number on a payslip and no error
 * anywhere.
 */
function warningsFor(slabs: SlabRow[]): string[] {
  const out: string[] = [];
  const ordered = [...slabs].sort((a, b) => a.fromAmount - b.fromAmount);
  if (ordered.length === 0) return out;

  if ((ordered[0] as SlabRow).fromAmount !== 0) out.push('The first band should start at 0.');

  const open = ordered.filter((slab) => slab.toAmount === null).length;
  if (open === 0) out.push('The top band should have no upper limit — leave it blank.');
  if (open > 1) out.push('Only the top band may be left open-ended.');

  for (const [index, slab] of ordered.entries()) {
    const next = ordered[index + 1];
    if (!next || slab.toAmount === null) continue;
    if (next.fromAmount > slab.toAmount) {
      out.push(`Nothing covers ${money(slab.toAmount)} to ${money(next.fromAmount)}.`);
    }
    if (next.fromAmount < slab.toAmount) {
      out.push(`The bands at ${money(slab.fromAmount)} and ${money(next.fromAmount)} overlap.`);
    }
    if (next.rate < slab.rate) {
      out.push(`${next.rate}% above ${slab.rate}% is almost always a transposition.`);
    }
  }
  return [...new Set(out)];
}

export function SlabEditor({
  items,
  disabled,
  onChange,
}: {
  items: SlabRow[];
  disabled: boolean;
  onChange: (items: SlabRow[]) => void;
}) {
  const sorted = [...items].sort((a, b) => a.fromAmount - b.fromAmount);
  const commit = (next: SlabRow[]) =>
    onChange([...next].sort((a, b) => a.fromAmount - b.fromAmount));
  const patch = (index: number, values: Partial<SlabRow>) =>
    commit(sorted.map((slab, i) => (i === index ? { ...slab, ...values } : slab)));
  const remove = (index: number) => onChange(sorted.filter((_, i) => i !== index));

  const warnings = warningsFor(sorted);

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <caption className="sr-only">Income tax bands for this year and regime</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-1.5 text-left font-medium">
              From
            </th>
            <th scope="col" className="py-1.5 text-left font-medium">
              Up to
            </th>
            <th scope="col" className="py-1.5 text-left font-medium">
              Rate
            </th>
            <th scope="col" className="w-10" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((slab, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
            <tr key={index} className="border-b last:border-0">
              <td className="py-1 pr-2">
                <Input
                  type="number"
                  min="0"
                  className="tabular-nums"
                  disabled={disabled}
                  aria-label={`Band ${index + 1} starts at`}
                  value={String(slab.fromAmount)}
                  onChange={(e) => patch(index, { fromAmount: toNumber(e.target.value) })}
                />
              </td>
              <td className="py-1 pr-2">
                {/* Blank is the open-ended top band. A number input cannot say
                    "no ceiling", so an empty string is the way to express it. */}
                <Input
                  type="number"
                  min="0"
                  className="tabular-nums"
                  placeholder="No limit"
                  disabled={disabled}
                  aria-label={`Band ${index + 1} ends at`}
                  value={slab.toAmount === null ? '' : String(slab.toAmount)}
                  onChange={(e) =>
                    patch(index, {
                      toAmount: e.target.value.trim() === '' ? null : toNumber(e.target.value),
                    })
                  }
                />
              </td>
              <td className="py-1 pr-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  className="tabular-nums"
                  disabled={disabled}
                  aria-label={`Band ${index + 1} rate`}
                  value={String(slab.rate)}
                  onChange={(e) => patch(index, { rate: toNumber(e.target.value) })}
                />
              </td>
              <td className="py-1">
                {!disabled && (
                  <IconAction
                    label={`Remove band ${index + 1}`}
                    icon={X}
                    size="icon-sm"
                    onClick={() => remove(index)}
                  />
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-center text-muted-foreground">
                No bands yet. Payroll refuses to deduct against a year with none.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={sorted.length >= 15}
          onClick={() => commit([...sorted, BLANK])}
        >
          <Plus className="size-4" aria-hidden /> Add a band
        </Button>
      )}

      {warnings.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            <ul className="list-inside list-disc">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
