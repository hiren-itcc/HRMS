import { describe, expect, it } from 'vitest';
import {
  ClaimStatusBadge,
  PaidBadge,
  ScheduledBadge,
} from '@/features/expenses/components/expense-badges';
import { render, screen } from '@/test/render';

/**
 * The distinction these exist to keep: "approved" and "you have the money" are
 * different questions.
 *
 * Folding the second into the first is how somebody chases a payment that was
 * agreed three weeks ago and paid last Friday — so the two are separate badges,
 * and this is what stops a later tidy-up merging them.
 */
describe('claim badges', () => {
  it('says the status in words, not only in colour', () => {
    render(<ClaimStatusBadge status="SUBMITTED" />);
    // "Awaiting approval", not an amber pill somebody has to interpret.
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
  });

  it('names every state it can be handed', () => {
    for (const [status, label] of [
      ['DRAFT', 'Draft'],
      ['APPROVED', 'Approved'],
      ['REJECTED', 'Declined'],
      ['CANCELLED', 'Withdrawn'],
    ] as const) {
      const { unmount } = render(<ClaimStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  /* Approved-and-paid and approved-and-waiting must not read the same. */
  it('distinguishes money that has gone out from money that is scheduled', () => {
    const { unmount } = render(<PaidBadge month="2026-09" />);
    expect(screen.getByText(/^Paid/)).toBeInTheDocument();
    unmount();

    render(<ScheduledBadge month="2026-09" />);
    expect(screen.getByText('Paid with 2026-09')).toBeInTheDocument();
    expect(screen.queryByText(/^Paid ·/)).not.toBeInTheDocument();
  });

  /* A claim paid before payroll months were recorded still has to render. */
  it('copes with a paid claim that carries no month', () => {
    render(<PaidBadge month={null} />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });
});
