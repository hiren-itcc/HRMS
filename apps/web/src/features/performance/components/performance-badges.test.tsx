import { describe, expect, it } from 'vitest';
import {
  CycleStatusBadge,
  GoalStatusBadge,
  OverdueBadge,
  RatingBadge,
  ReviewStatusBadge,
} from '@/features/performance/components/performance-badges';
import { render, screen } from '@/test/render';

/**
 * Colour is a second reading, not the only one. A screen about somebody's
 * performance is the last place to make them ask "is the amber one bad?".
 */
describe('performance badges', () => {
  it('names every review state in words', () => {
    for (const [status, label] of [
      ['PENDING_SELF', 'Awaiting self-assessment'],
      ['PENDING_MANAGER', 'With the manager'],
      ['SHARED', 'Shared'],
      ['ACKNOWLEDGED', 'Signed off'],
      ['CANCELLED', 'Dropped'],
    ] as const) {
      const { unmount } = render(<ReviewStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('names every goal state', () => {
    for (const [status, label] of [
      ['ACTIVE', 'In progress'],
      ['ACHIEVED', 'Achieved'],
      ['MISSED', 'Missed'],
      ['CANCELLED', 'Dropped'],
    ] as const) {
      const { unmount } = render(<GoalStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('names every cycle state', () => {
    for (const [status, label] of [
      ['DRAFT', 'Not started'],
      ['OPEN', 'Running'],
      ['CLOSED', 'Closed'],
    ] as const) {
      const { unmount } = render(<CycleStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  /*
   * A bare "4" means nothing without the scale beside it — which is the same
   * reason the form uses a radio group rather than a select.
   */
  it('puts the words next to the number', () => {
    render(<RatingBadge rating={3} />);
    expect(screen.getByText(/3 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText(/Meets expectations/)).toBeInTheDocument();
  });

  /*
   * The regression guard for the whole Decimal class of bug. Ratings are Int
   * columns in this module deliberately, so this renders a number. If somebody
   * makes them Decimal(3,2) for half-points, the API starts sending "4.00" as
   * a string and this is where it surfaces rather than as a silent NaN.
   */
  it('renders an unrated review as a dash rather than NaN or null', () => {
    const { unmount } = render(<RatingBadge rating={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    unmount();

    render(<RatingBadge rating={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('says overdue in words', () => {
    render(<OverdueBadge />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });
});
