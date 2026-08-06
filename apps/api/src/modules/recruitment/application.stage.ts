import type { ApplicationStage, OfferStatus, OpeningStatus } from '../../generated/prisma/enums';

/**
 * What a hiring pipeline may and may not do.
 *
 * Pure: no Prisma, no clock, nothing injected. The same shape as
 * `asset.status.ts` and `settlement.calc.ts`, and for the same reason — these
 * are the rules somebody will argue about, and an argument is easier to settle
 * against a table than against a service method with a database in it.
 */

/** In order. The index is what makes "forwards" and "backwards" meaningful. */
export const PIPELINE: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];

/**
 * Ends. A rejected candidate is not moved back into screening — if the
 * decision was wrong, that is a new application, and the history should say
 * two things happened rather than pretend one did.
 */
export const TERMINAL: ApplicationStage[] = ['HIRED', 'REJECTED', 'WITHDRAWN'];

export const isTerminal = (stage: ApplicationStage) => TERMINAL.includes(stage);

export interface StageMove {
  from: ApplicationStage;
  to: ApplicationStage;
  /** Whether an accepted offer exists. Only HIRED cares. */
  hasAcceptedOffer: boolean;
}

export type StageVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether a pipeline move is allowed.
 *
 * Backwards *within* the pipeline is allowed on purpose: sending somebody from
 * INTERVIEW back to SCREENING is a real thing that happens when a round is
 * rescheduled or a second opinion is wanted. What is not allowed is coming
 * back from an ending.
 */
export function canMoveStage({ from, to, hasAcceptedOffer }: StageMove): StageVerdict {
  if (from === to) return { ok: false, reason: `It is already at ${label(to)}.` };

  if (isTerminal(from)) {
    return {
      ok: false,
      reason:
        from === 'HIRED'
          ? 'They have already been hired. Reopening that means a new application.'
          : `This application ended at ${label(from)}. Start a new one rather than reviving it.`,
    };
  }

  // Rejecting or withdrawing is always available while the application is live.
  if (to === 'REJECTED' || to === 'WITHDRAWN') return { ok: true };

  /*
   * The rule the whole module exists to protect. HIRED is what creates a
   * login, a payroll subject and an onboarding record, so it may only be
   * reached from an offer somebody actually accepted.
   */
  if (to === 'HIRED') {
    if (from !== 'OFFER') {
      return { ok: false, reason: 'Only an application at the offer stage can be hired.' };
    }
    if (!hasAcceptedOffer) {
      return { ok: false, reason: 'The offer has not been accepted yet.' };
    }
    return { ok: true };
  }

  const fromIndex = PIPELINE.indexOf(from);
  const toIndex = PIPELINE.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) {
    return { ok: false, reason: `${label(to)} is not a stage this pipeline has.` };
  }

  // Forwards, one step at a time. Skipping SCREENING to book an interview is
  // the sort of thing that leaves the funnel reporting a lie.
  if (toIndex > fromIndex + 1) {
    return {
      ok: false,
      reason: `Move it to ${label(PIPELINE[fromIndex + 1] as ApplicationStage)} first.`,
    };
  }

  return { ok: true };
}

/**
 * Whether an offer may be raised at all.
 *
 * Its own function rather than folded into the stage move, because it is asked
 * at a different moment: the offer is created *while* the application sits at
 * OFFER, not as part of arriving there.
 */
export function canRaiseOffer(stage: ApplicationStage): StageVerdict {
  if (stage !== 'OFFER') {
    return {
      ok: false,
      reason: `Move the application to the offer stage first — it is at ${label(stage)}.`,
    };
  }
  return { ok: true };
}

/** Offer statuses from which nothing further happens. */
const OFFER_ENDED: OfferStatus[] = ['ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'];

export function canRespondToOffer(status: OfferStatus): StageVerdict {
  if (status === 'DRAFT') return { ok: false, reason: 'Send the offer before recording a reply.' };
  if (OFFER_ENDED.includes(status)) {
    return { ok: false, reason: `This offer is already ${status.toLowerCase()}.` };
  }
  return { ok: true };
}

/**
 * Whether an opening can be closed.
 *
 * Refused while applications are still live, rather than closing and leaving
 * them pointing at a dead opening. The caller either rejects them first or
 * puts the opening on hold, and both of those are decisions a person should
 * make rather than a side effect they discover later.
 */
export function canCloseOpening(liveApplications: number): StageVerdict {
  if (liveApplications > 0) {
    return {
      ok: false,
      reason:
        `${liveApplications} application${liveApplications === 1 ? ' is' : 's are'} still open. ` +
        'Reject or withdraw them first, or put the opening on hold instead.',
    };
  }
  return { ok: true };
}

/**
 * Whether an opening will take another application.
 *
 * DRAFT is included in the refusal: an opening nobody has published should not
 * be collecting candidates, and finding out later that it did is worse than
 * being told now.
 */
export function acceptsApplications(status: OpeningStatus): StageVerdict {
  if (status === 'OPEN') return { ok: true };
  const why: Record<Exclude<OpeningStatus, 'OPEN'>, string> = {
    DRAFT: 'This opening is still a draft. Publish it before adding candidates.',
    ON_HOLD: 'This opening is on hold.',
    CLOSED: 'This opening is closed.',
    FILLED: 'This opening has been filled.',
  };
  return { ok: false, reason: why[status] };
}

/** Sentence case for a stage, for the messages above. */
function label(stage: ApplicationStage): string {
  const word = stage.toLowerCase().replace(/_/g, ' ');
  return word.charAt(0).toUpperCase() + word.slice(1);
}
