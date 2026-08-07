import { describe, expect, it } from 'vitest';
import { resignationSteps } from './resignation-status';

const base = { routedManagerId: 'mgr1', offboardingStatus: null as string | null };
const labels = (input: Parameters<typeof resignationSteps>[0]) =>
  resignationSteps(input).map((s) => `${s.label}:${s.state}`);

describe('resignationSteps', () => {
  it('walks the four stages as the request moves', () => {
    expect(labels({ ...base, status: 'SUBMITTED' })).toEqual([
      'Submitted:done',
      'Manager review:current',
      'HR review:todo',
      'Offboarding:todo',
      'Completed:todo',
    ]);

    expect(labels({ ...base, status: 'MANAGER_APPROVED' })).toEqual([
      'Submitted:done',
      'Manager review:done',
      'HR review:current',
      'Offboarding:todo',
      'Completed:todo',
    ]);
  });

  /*
   * Whoever is at the top of the org chart has no manager, and neither does
   * anybody when the organization turns that step off. Showing a stage that
   * can never complete would read as a request that is stuck.
   */
  it('omits the manager stage entirely when nobody was routed to', () => {
    expect(labels({ ...base, routedManagerId: null, status: 'SUBMITTED' })).toEqual([
      'Submitted:done',
      'HR review:current',
      'Offboarding:todo',
      'Completed:todo',
    ]);
  });

  it('reads the offboarding stage from the offboarding record, not the status', () => {
    expect(labels({ ...base, status: 'APPROVED', offboardingStatus: 'IN_PROGRESS' })).toContain(
      'Offboarding:current',
    );

    expect(labels({ ...base, status: 'COMPLETED', offboardingStatus: 'COMPLETED' })).toEqual([
      'Submitted:done',
      'Manager review:done',
      'HR review:done',
      'Offboarding:done',
      'Completed:done',
    ]);
  });

  /* Everything after the point it stopped is not "not yet", it is "never". */
  it('truncates at the point it was rejected', () => {
    expect(labels({ ...base, status: 'REJECTED' })).toEqual(['Submitted:done', 'Rejected:failed']);
  });

  it('truncates at the point it was withdrawn', () => {
    const steps = labels({ ...base, status: 'WITHDRAWN' });
    expect(steps.at(-1)).toBe('Withdrawn:failed');
    expect(steps).not.toContain('Completed:todo');
  });

  it('says a sent-back request is with the employee', () => {
    const steps = resignationSteps({ ...base, status: 'CHANGES_REQUESTED' });
    expect(steps.find((s) => s.label === 'HR review')?.hint).toBe('Sent back for changes');
  });

  it('marks a cancelled offboarding rather than dropping the stage', () => {
    const steps = resignationSteps({
      ...base,
      status: 'APPROVED',
      offboardingStatus: 'CANCELLED',
    });
    expect(steps.find((s) => s.label === 'Offboarding')?.hint).toBe('Cancelled');
  });
});
