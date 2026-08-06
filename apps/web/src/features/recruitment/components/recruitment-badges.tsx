import {
  APPLICATION_STAGE_LABELS,
  type ApplicationStageCode,
  INTERVIEW_RECOMMENDATION_LABELS,
  type InterviewRecommendationCode,
  OFFER_STATUS_LABELS,
  type OfferStatusCode,
  OPENING_STATUS_LABELS,
  type OpeningStatusCode,
} from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';

/**
 * Every badge in here says its state in words. Colour is a second reading, not
 * the only one — the same rule the asset register and the leave screens follow,
 * because "is the amber one bad?" is a question a pipeline should never make
 * somebody ask.
 */

const OPENING_TONE: Record<OpeningStatusCode, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  OPEN: 'bg-success/15 text-success-text',
  ON_HOLD: 'bg-warning/15 text-warning-text',
  CLOSED: 'bg-muted text-muted-foreground',
  FILLED: 'bg-info/15 text-info-text',
};

export function OpeningStatusBadge({ status }: { status: OpeningStatusCode }) {
  return (
    <Badge className={cn('border-transparent', OPENING_TONE[status])}>
      {OPENING_STATUS_LABELS[status]}
    </Badge>
  );
}

/*
 * The four live stages share one tone on purpose. They are progress, not
 * verdicts, and colouring APPLIED differently from INTERVIEW would suggest one
 * is worse news than the other. Only the three endings stand out.
 */
const STAGE_TONE: Record<ApplicationStageCode, string> = {
  APPLIED: 'bg-info/15 text-info-text',
  SCREENING: 'bg-info/15 text-info-text',
  INTERVIEW: 'bg-info/15 text-info-text',
  // The brand pair, because reaching offer is the one live stage worth
  // spotting. `primary/15` is what `--primary-text` was solved against — the
  // contrast gate measures that exact pairing in every theme.
  OFFER: 'bg-primary/15 text-primary-text',
  HIRED: 'bg-success/15 text-success-text',
  REJECTED: 'bg-destructive/15 text-destructive-text',
  WITHDRAWN: 'bg-muted text-muted-foreground',
};

export function StageBadge({ stage }: { stage: ApplicationStageCode }) {
  return (
    <Badge className={cn('border-transparent', STAGE_TONE[stage])}>
      {APPLICATION_STAGE_LABELS[stage]}
    </Badge>
  );
}

const OFFER_TONE: Record<OfferStatusCode, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SENT: 'bg-info/15 text-info-text',
  ACCEPTED: 'bg-success/15 text-success-text',
  DECLINED: 'bg-destructive/15 text-destructive-text',
  WITHDRAWN: 'bg-muted text-muted-foreground',
  EXPIRED: 'bg-warning/15 text-warning-text',
};

export function OfferStatusBadge({ status }: { status: OfferStatusCode }) {
  return (
    <Badge className={cn('border-transparent', OFFER_TONE[status])}>
      {OFFER_STATUS_LABELS[status]}
    </Badge>
  );
}

const RECOMMENDATION_TONE: Record<InterviewRecommendationCode, string> = {
  STRONG_YES: 'bg-success/15 text-success-text',
  YES: 'bg-success/15 text-success-text',
  NO: 'bg-destructive/15 text-destructive-text',
  STRONG_NO: 'bg-destructive/15 text-destructive-text',
};

export function RecommendationBadge({
  recommendation,
}: {
  recommendation: InterviewRecommendationCode;
}) {
  return (
    <Badge className={cn('border-transparent', RECOMMENDATION_TONE[recommendation])}>
      {INTERVIEW_RECOMMENDATION_LABELS[recommendation]}
    </Badge>
  );
}
