import { RESIGNATION_STATUS_LABELS, type ResignationStatusCode } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';
import { Check, Clock, RotateCcw, X } from 'lucide-react';

/** Tone only reinforces the label; the words carry the meaning on their own. */
const TONE: Record<ResignationStatusCode, string> = {
  SUBMITTED: 'bg-info/15 text-info-text',
  MANAGER_APPROVED: 'bg-info/15 text-info-text',
  CHANGES_REQUESTED: 'bg-warning/15 text-warning-text',
  APPROVED: 'bg-success/15 text-success-text',
  REJECTED: 'bg-destructive/15 text-destructive-text',
  WITHDRAWN: 'bg-muted text-muted-foreground',
  COMPLETED: 'bg-muted text-muted-foreground',
};

export function ResignationStatusBadge({ status }: { status: ResignationStatusCode }) {
  return (
    <Badge className={cn('border-transparent', TONE[status])}>
      {RESIGNATION_STATUS_LABELS[status]}
    </Badge>
  );
}

type StepState = 'done' | 'current' | 'todo' | 'failed';

interface Step {
  label: string;
  state: StepState;
  hint?: string | null;
}

/**
 * Where the request has got to.
 *
 * The steps are derived from the status rather than stored, so there is no
 * second representation of the workflow to drift from the transition table.
 * "Offboarding" reads its state from the offboarding record, which is why that
 * step exists here and not as a resignation status — one fact, one place.
 */
export function resignationSteps(input: {
  status: ResignationStatusCode;
  routedManagerId: string | null;
  offboardingStatus: string | null;
}): Step[] {
  const { status, routedManagerId, offboardingStatus } = input;

  const stopped = status === 'REJECTED' ? 'Rejected' : status === 'WITHDRAWN' ? 'Withdrawn' : null;
  const order: ResignationStatusCode[] = ['SUBMITTED', 'MANAGER_APPROVED', 'APPROVED', 'COMPLETED'];
  const reached = (target: ResignationStatusCode) =>
    order.indexOf(status) >= order.indexOf(target) && order.indexOf(status) >= 0;

  const steps: Step[] = [{ label: 'Submitted', state: 'done' }];

  // The manager step is skipped outright when nobody was routed to, rather
  // than shown as a stage that will never complete.
  if (routedManagerId) {
    steps.push({
      label: 'Manager review',
      state:
        stopped && status !== 'REJECTED'
          ? 'todo'
          : reached('MANAGER_APPROVED')
            ? 'done'
            : status === 'SUBMITTED'
              ? 'current'
              : 'todo',
    });
  }

  steps.push({
    label: 'HR review',
    state: reached('APPROVED')
      ? 'done'
      : status === 'MANAGER_APPROVED' || (status === 'SUBMITTED' && !routedManagerId)
        ? 'current'
        : 'todo',
    hint: status === 'CHANGES_REQUESTED' ? 'Sent back for changes' : null,
  });

  steps.push({
    label: 'Offboarding',
    state:
      offboardingStatus === 'COMPLETED'
        ? 'done'
        : offboardingStatus === 'IN_PROGRESS'
          ? 'current'
          : 'todo',
    hint: offboardingStatus === 'CANCELLED' ? 'Cancelled' : null,
  });

  steps.push({ label: 'Completed', state: status === 'COMPLETED' ? 'done' : 'todo' });

  if (stopped) {
    // Everything after the point it stopped is not "not yet", it is "never".
    const failedAt = steps.findIndex((s) => s.state === 'current' || s.state === 'todo');
    if (failedAt >= 0) {
      steps[failedAt] = { label: stopped, state: 'failed' };
      return steps.slice(0, failedAt + 1);
    }
  }
  return steps;
}

const ICON: Record<StepState, typeof Check> = {
  done: Check,
  current: Clock,
  todo: Clock,
  failed: X,
};

const STATE_STYLE: Record<StepState, string> = {
  done: 'bg-success/15 text-success-text',
  current: 'bg-info/15 text-info-text',
  todo: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/15 text-destructive-text',
};

/**
 * An `<ol>`, not a row of divs: it is an ordered list of stages and that is
 * what a screen reader should hear. Each item states its own state in words
 * as well as by icon and tone.
 */
export function ResignationStepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {steps.map((step) => {
        const Icon = step.state === 'todo' ? RotateCcw : ICON[step.state];
        const stateWord =
          step.state === 'done'
            ? 'done'
            : step.state === 'current'
              ? 'in progress'
              : step.state === 'failed'
                ? 'stopped here'
                : 'not started';
        return (
          <li
            key={step.label}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm',
              STATE_STYLE[step.state],
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span>{step.label}</span>
            <span className="sr-only">({stateWord})</span>
            {step.hint && <span className="text-xs opacity-80">— {step.hint}</span>}
          </li>
        );
      })}
    </ol>
  );
}
