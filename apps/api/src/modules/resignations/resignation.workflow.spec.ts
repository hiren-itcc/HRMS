import type { ResignationStatusCode } from '@hrms/shared';
import {
  awaitingDesk,
  canTransition,
  isWithEmployee,
  nextStatus,
  RESIGNATION_ACTION_PERMISSION,
  type ResignationAction,
  transitionError,
} from './resignation.workflow';

const TERMINAL: ResignationStatusCode[] = ['REJECTED', 'WITHDRAWN', 'COMPLETED'];
const ALL_ACTIONS: ResignationAction[] = [
  'withdraw',
  'manager_approve',
  'manager_reject',
  'request_changes',
  'resubmit',
  'hr_approve',
  'hr_reject',
  'complete',
  'reopen',
];

describe('the happy path', () => {
  it('walks submitted → manager → HR → approved → completed', () => {
    expect(nextStatus('SUBMITTED', 'manager_approve')).toBe('MANAGER_APPROVED');
    expect(nextStatus('MANAGER_APPROVED', 'hr_approve')).toBe('APPROVED');
    expect(nextStatus('APPROVED', 'complete')).toBe('COMPLETED');
  });

  /*
   * The flat-organization case, and the top of the org chart. Without it,
   * anyone with no reporting manager would sit at SUBMITTED with nobody able
   * to move them.
   */
  it('lets HR approve straight from submitted', () => {
    expect(canTransition('SUBMITTED', 'hr_approve')).toBe(true);
  });

  it('sends back and takes it again', () => {
    expect(nextStatus('SUBMITTED', 'request_changes')).toBe('CHANGES_REQUESTED');
    expect(nextStatus('MANAGER_APPROVED', 'request_changes')).toBe('CHANGES_REQUESTED');
    expect(nextStatus('CHANGES_REQUESTED', 'resubmit')).toBe('SUBMITTED');
  });
});

describe('the rules the brief asks for, as the table rather than as ifs', () => {
  it('cannot approve twice', () => {
    expect(canTransition('APPROVED', 'hr_approve')).toBe(false);
    expect(canTransition('MANAGER_APPROVED', 'manager_approve')).toBe(false);
  });

  it('cannot withdraw once approved', () => {
    expect(canTransition('APPROVED', 'withdraw')).toBe(false);
    // …and says what to do instead, rather than only refusing.
    expect(transitionError('APPROVED', 'withdraw')).toMatch(/cancel the offboarding/i);
  });

  it('can withdraw at any point before that', () => {
    for (const status of ['SUBMITTED', 'MANAGER_APPROVED', 'CHANGES_REQUESTED'] as const) {
      expect(canTransition(status, 'withdraw')).toBe(true);
    }
  });

  it('cannot complete before approval — offboarding never starts early', () => {
    for (const status of ['SUBMITTED', 'MANAGER_APPROVED', 'CHANGES_REQUESTED'] as const) {
      expect(canTransition(status, 'complete')).toBe(false);
    }
    expect(canTransition('APPROVED', 'complete')).toBe(true);
  });

  it('lets a cancelled offboarding put the request back on HR’s desk', () => {
    expect(nextStatus('APPROVED', 'reopen')).toBe('MANAGER_APPROVED');
  });

  it.each(TERMINAL)('accepts nothing at all once %s', (status) => {
    for (const action of ALL_ACTIONS) {
      expect(canTransition(status, action)).toBe(false);
    }
  });
});

describe('refusal messages', () => {
  it.each([
    ['WITHDRAWN', /withdrawn/i],
    ['REJECTED', /rejected/i],
    ['COMPLETED', /already complete/i],
  ] as const)('names the terminal state for %s', (status, pattern) => {
    expect(transitionError(status, 'hr_approve')).toMatch(pattern);
  });

  it('otherwise says which states would have worked', () => {
    expect(transitionError('CHANGES_REQUESTED', 'hr_approve')).toBe(
      'Cannot do that while the resignation is CHANGES_REQUESTED — it must be MANAGER_APPROVED or SUBMITTED',
    );
  });
});

describe('helpers the UI and the service share', () => {
  it('knows when the ball is with the employee', () => {
    expect(isWithEmployee('SUBMITTED')).toBe(true);
    expect(isWithEmployee('CHANGES_REQUESTED')).toBe(true);
    expect(isWithEmployee('MANAGER_APPROVED')).toBe(false);
    expect(isWithEmployee('APPROVED')).toBe(false);
  });

  it('names the desk it is sitting on', () => {
    expect(awaitingDesk('SUBMITTED', 'mgr1')).toBe('MANAGER');
    expect(awaitingDesk('MANAGER_APPROVED', 'mgr1')).toBe('HR');
    expect(awaitingDesk('APPROVED', 'mgr1')).toBeNull();
    expect(awaitingDesk('CHANGES_REQUESTED', 'mgr1')).toBeNull();
  });

  /* Whoever is at the top of the org chart has no manager, and neither does
     anybody when the organization turns that step off. Without this they would
     sit at SUBMITTED with no desk able to act. */
  it('parks an unrouted request at HR rather than at nobody', () => {
    expect(awaitingDesk('SUBMITTED', null)).toBe('HR');
  });

  /* Separation of duties: nobody who can only approve for their team should
     be able to give final sign-off. */
  it('demands the org-wide permission for HR decisions', () => {
    expect(RESIGNATION_ACTION_PERMISSION.hr_approve).toBe('resignation.approve');
    expect(RESIGNATION_ACTION_PERMISSION.manager_approve).toBe('resignation.approve.team');
  });

  it('gives every action a permission', () => {
    for (const action of ALL_ACTIONS) {
      expect(RESIGNATION_ACTION_PERMISSION[action]).toBeTruthy();
    }
  });
});
