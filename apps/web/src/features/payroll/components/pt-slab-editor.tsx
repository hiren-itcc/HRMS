'use client';

import type { OrgSettings } from '@hrms/shared';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { Plus, TriangleAlert, X } from 'lucide-react';
import { IconAction } from '@/components/icon-action';

type Slab = OrgSettings['payroll']['professionalTax']['slabs'][number];

/**
 * The final band's `upTo` is stored as this — "every gross above every other
 * band". A literal 9007199254740991 in a number input means nothing to an
 * operator, so it is rendered as a read-only label instead of an editable
 * bound.
 */
const SENTINEL = Number.MAX_SAFE_INTEGER;
const isSentinel = (slab: Slab) => slab.upTo === SENTINEL;

const BLANK: Slab = { upTo: 0, amount: 0 };

/**
 * A number input hands back a string; an empty or unparseable one falls back
 * to zero rather than to whatever the field held before, because there is no
 * other floor a rupee amount or a wage bound could sensibly fall back to.
 */
function toNumber(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Professional tax slabs.
 *
 * Edits here apply to the *next* payroll run and to any DRAFT or IN_REVIEW
 * run the moment it is recalculated — published payslips keep the rates they
 * were run with. The page's confirmation dialog says this before Save is
 * allowed to fire; this component only edits the array.
 */
export function PtSlabEditor({
  items,
  disabled,
  onChange,
}: {
  items: Slab[];
  disabled: boolean;
  onChange: (items: Slab[]) => void;
}) {
  /*
   * Sorted ascending by `upTo`, both for display and before every write.
   * `professionalTax()` (apps/api/src/modules/payroll/payroll.statutory.ts)
   * already sorts defensively when it reads these, so this ordering is for
   * legibility only — it is not what makes a mis-ordered configuration safe.
   */
  const sorted = [...items].sort((a, b) => a.upTo - b.upTo);

  const commit = (next: Slab[]) => onChange([...next].sort((a, b) => a.upTo - b.upTo));

  const patch = (index: number, values: Partial<Slab>) =>
    commit(sorted.map((slab, i) => (i === index ? { ...slab, ...values } : slab)));

  /*
   * No reorder controls, deliberately — unlike `ExitChecklistEditor`, whose
   * shape this otherwise follows.
   *
   * A band's position *is* its upper bound: change the bound and it moves.
   * `commit` re-sorts on every write, so a move button could only ever break a
   * tie between two slabs sharing an `upTo`, and `professionalTax()` in
   * `payroll.statutory.ts` sorts again when reading — so a hand-ordered array
   * would be an order the payroll engine ignores. Buttons that appear to do
   * something and do not are worse than absent ones.
   */
  const remove = (index: number) => onChange(sorted.filter((_, i) => i !== index));

  // Two soft, non-blocking checks. A state may legitimately have a slab table
  // we did not anticipate, so neither refuses a save — both only advise.
  const highestAmount = sorted.reduce((max, slab) => Math.max(max, slab.amount), 0);
  const exceedsAnnualCap = highestAmount * 12 > 2500;
  const descendingIndex = sorted.findIndex(
    (slab, i) => i > 0 && slab.amount < sorted[i - 1].amount,
  );

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {sorted.map((slab, index) => {
          const sentinel = isSentinel(slab);
          return (
            // Order is the identity here — slabs carry no id of their own,
            // and the display order is always the sorted one, not whatever
            // order the array arrived in.
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
            <li key={index} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <span className="w-14 shrink-0 text-muted-foreground text-xs">Slab {index + 1}</span>

              {sentinel ? (
                <span className="text-sm">Above the last band</span>
              ) : (
                <>
                  <span className="text-muted-foreground text-sm">Up to ₹</span>
                  <Input
                    aria-label={`Slab ${index + 1} upper bound`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    className="w-28"
                    disabled={disabled}
                    value={slab.upTo}
                    onChange={(e) => patch(index, { upTo: toNumber(e.target.value) })}
                  />
                </>
              )}

              <span className="text-muted-foreground text-sm">→ ₹</span>
              <Input
                aria-label={`Slab ${index + 1} amount`}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                className="w-24"
                disabled={disabled}
                value={slab.amount}
                onChange={(e) => patch(index, { amount: toNumber(e.target.value) })}
              />
              <span className="text-muted-foreground text-sm">per month</span>

              <div className="ml-auto flex shrink-0 gap-1">
                <IconAction
                  label={`Remove slab ${index + 1}`}
                  icon={X}
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => remove(index)}
                  disabled={disabled}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={sorted.length >= 20}
          onClick={() => commit([...sorted, BLANK])}
        >
          <Plus className="size-4" aria-hidden /> Add a slab
        </Button>
      )}

      {exceedsAnnualCap && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>Highest slab exceeds ₹2,500 a year</AlertTitle>
          <AlertDescription>
            Article 276 caps what any state may levy in professional tax per person per year. At ₹
            {highestAmount} a month this comes to ₹{(highestAmount * 12).toLocaleString('en-IN')} —
            worth checking against the state's published slabs before saving.
          </AlertDescription>
        </Alert>
      )}

      {descendingIndex !== -1 && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>A higher band charges less than the one below it</AlertTitle>
          <AlertDescription>
            Slab {descendingIndex + 1} charges less per month than slab {descendingIndex}. A state
            can genuinely do this, but it is almost always a typo.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
