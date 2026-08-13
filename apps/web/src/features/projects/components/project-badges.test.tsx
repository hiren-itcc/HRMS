import { PROJECT_STATUSES, TIMESHEET_STATUSES } from '@hrms/shared';
import { describe, expect, it } from 'vitest';
import {
  ProjectStatusBadge,
  RolledOffBadge,
  TimesheetStatusBadge,
} from '@/features/projects/components/project-badges';
import { render, screen } from '@/test/render';

/**
 * Two distinctions these exist to keep.
 *
 * A state is readable in words, not only in colour. And "the project is
 * running" and "this person is still on it" are different questions — folding
 * them together is how somebody who rolled off last month keeps looking like a
 * live allocation.
 */
describe('project badges', () => {
  it('says the status in words, not only in colour', () => {
    render(<ProjectStatusBadge status="ON_HOLD" />);
    // "On hold", not an amber pill somebody has to interpret.
    expect(screen.getByText('On hold')).toBeInTheDocument();
  });

  /*
   * Driven off the shared constant rather than a hand-written list: a status
   * added to the enum and not to the tone map renders an empty pill, and this
   * is what catches it.
   */
  it('names every project status the enum can produce', () => {
    for (const status of PROJECT_STATUSES) {
      const { container, unmount } = render(<ProjectStatusBadge status={status} />);
      expect(container.textContent?.trim()).toBeTruthy();
      unmount();
    }
  });

  it('names every timesheet status the enum can produce', () => {
    for (const status of TIMESHEET_STATUSES) {
      const { container, unmount } = render(<TimesheetStatusBadge status={status} />);
      expect(container.textContent?.trim()).toBeTruthy();
      unmount();
    }
  });

  it('calls a sent-back week sent back, not rejected', () => {
    render(<TimesheetStatusBadge status="REJECTED" />);
    expect(screen.getByText('Sent back')).toBeInTheDocument();
  });

  it('keeps having left a project separate from the project being closed', () => {
    render(
      <>
        <ProjectStatusBadge status="ACTIVE" />
        <RolledOffBadge on="2026-07-31" />
      </>,
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Left 2026-07-31')).toBeInTheDocument();
  });
});
