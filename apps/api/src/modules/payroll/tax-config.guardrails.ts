/**
 * What may be saved as a financial year's tax rules.
 *
 * Pure, like `pay-components.guardrails.ts` and `projects.rules.ts` — no
 * Prisma, no clock. `GuardrailReason` is `string | null` where the string *is*
 * the sentence shown to the operator, so every refusal is a message somebody
 * can act on rather than a boolean the caller has to translate.
 *
 * The slab checks are the load-bearing part. A gap between two bands silently
 * **under-taxes** every income that falls in it — no error, no warning, just a
 * smaller number on a payslip — and nothing downstream would notice.
 * `calculateTaxBySlabs` walks whatever table it is handed and accumulates; it
 * cannot tell a deliberate table from a mistyped one. This is the only place
 * that can.
 */

export type GuardrailReason = string | null;

export interface SlabLike {
  fromAmount: number;
  /** Null is the open-ended top band. */
  toAmount: number | null;
  rate: number;
}

export interface SurchargeBandLike {
  aboveIncome: number;
  rate: number;
}

/** Rupees, for a message. Plain and unlocalised — this is an error string. */
function money(value: number): string {
  return value.toLocaleString('en-IN');
}

/**
 * Everything wrong with a slab table, in one pass.
 *
 * All of them at once rather than the first, for the reason
 * `submissionProblems` gives in the expenses and projects modules: being told
 * about one problem, fixing it, and only then hearing about the next is what
 * makes people give up on a form.
 *
 * Returns an empty array for a table that is fine.
 */
export function slabProblems(slabs: SlabLike[]): string[] {
  const problems: string[] = [];
  if (slabs.length === 0) return ['Add at least one tax band'];

  const ordered = [...slabs].sort((a, b) => a.fromAmount - b.fromAmount);

  // The first band has to start at zero, or income below it is taxed by no
  // band at all and silently disappears from the calculation.
  const first = ordered[0] as SlabLike;
  if (first.fromAmount !== 0) {
    problems.push(`The first band must start at 0, not ${money(first.fromAmount)}`);
  }

  const openEnded = ordered.filter((slab) => slab.toAmount === null);
  if (openEnded.length === 0) {
    problems.push('The top band must be open-ended — leave its upper limit blank');
  }
  if (openEnded.length > 1) {
    problems.push(
      `${openEnded.length} bands have no upper limit; only the top one may be open-ended`,
    );
  }
  const last = ordered[ordered.length - 1] as SlabLike;
  if (openEnded.length === 1 && last.toAmount !== null) {
    problems.push('The open-ended band must be the highest one');
  }

  for (const [index, slab] of ordered.entries()) {
    if (slab.rate < 0 || slab.rate > 100) {
      problems.push(`A rate of ${slab.rate}% is not a percentage`);
    }
    if (slab.toAmount !== null && slab.toAmount <= slab.fromAmount) {
      problems.push(
        `The band starting at ${money(slab.fromAmount)} ends at ${money(slab.toAmount)}, which is not above it`,
      );
    }

    const next = ordered[index + 1];
    if (!next || slab.toAmount === null) continue;

    // The whole point of this module. A gap under-taxes; an overlap taxes the
    // same rupee twice.
    if (next.fromAmount > slab.toAmount) {
      problems.push(
        `Nothing covers ${money(slab.toAmount)} to ${money(next.fromAmount)} — bands must not leave a gap`,
      );
    }
    if (next.fromAmount < slab.toAmount) {
      problems.push(`The bands at ${money(slab.fromAmount)} and ${money(next.fromAmount)} overlap`);
    }
    // A progressive table never charges less on a higher slice. This is a
    // refusal rather than a warning because it is not expressible as a
    // deliberate policy — the engine accumulates band by band, so a lower rate
    // above a higher one is always a transposition.
    if (next.rate < slab.rate) {
      problems.push(
        `The band from ${money(next.fromAmount)} is charged ${next.rate}%, below the ${slab.rate}% beneath it`,
      );
    }
  }

  return [...new Set(problems)];
}

/** Surcharge bands ascend and are percentages. Gaps are meaningless here — a
 * band applies above a threshold, so they are thresholds rather than slices. */
export function surchargeProblems(bands: SurchargeBandLike[]): string[] {
  const problems: string[] = [];
  const ordered = [...bands].sort((a, b) => a.aboveIncome - b.aboveIncome);

  for (const [index, band] of ordered.entries()) {
    if (band.rate < 0 || band.rate > 100) {
      problems.push(`A surcharge of ${band.rate}% is not a percentage`);
    }
    const next = ordered[index + 1];
    if (next && next.aboveIncome === band.aboveIncome) {
      problems.push(`Two surcharge bands both start above ${money(band.aboveIncome)}`);
    }
    if (next && next.rate < band.rate) {
      problems.push(
        `Surcharge above ${money(next.aboveIncome)} is ${next.rate}%, below the ${band.rate}% beneath it`,
      );
    }
  }
  return [...new Set(problems)];
}

export interface ConfirmableConfig {
  slabs: SlabLike[];
  source: string | null | undefined;
}

/**
 * Why this year cannot be marked CONFIRMED.
 *
 * Confirming is the act that lets payroll deduct against these numbers, so it
 * is where the bar sits. A `source` is required because "where did these come
 * from" is the first question anybody asks of a rate table and the second is
 * "when" — and an unsourced table is one nobody can check.
 */
export function confirmBlockedReason(config: ConfirmableConfig): GuardrailReason {
  if (config.slabs.length === 0) {
    return 'Add the tax bands before confirming this year — payroll will deduct against them.';
  }
  if (!config.source?.trim()) {
    return 'Say where these figures came from before confirming — a Finance Act, a circular, or your accountant. An unsourced rate table is one nobody can check.';
  }
  const problems = slabProblems(config.slabs);
  if (problems.length > 0) return problems.join(' · ');
  return null;
}

/**
 * Why this year cannot be returned to UNCONFIRMED.
 *
 * Because `tdsForRun` **skips** an employee whose year is unconfirmed rather
 * than deducting zero, un-confirming mid-year would quietly stop TDS for the
 * whole workforce — every payslip from then on simply carrying no tax line, and
 * the shortfall landing on people in March.
 *
 * Correcting a wrong rate is done by editing it, which recalculates the
 * remaining months. That is always the better move.
 */
export function unconfirmBlockedReason(deductedSoFar: number): GuardrailReason {
  if (deductedSoFar > 0) {
    return `₹${money(deductedSoFar)} of tax has already been deducted against this year, so it cannot go back to unconfirmed — payroll would stop deducting entirely from the next run. Correct the figures instead; the remaining months adjust for what was already taken.`;
  }
  return null;
}
