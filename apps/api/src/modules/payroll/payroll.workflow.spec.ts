import {
  canPay,
  canTransition,
  canTransitionPayment,
  isPayslipVisibleToEmployee,
  nextStatus,
  type PaymentStatus,
  RUN_ACTION_PERMISSION,
  type RunAction,
  type RunStatus,
  transitionError,
} from './payroll.workflow';

const ALL_STATUSES: RunStatus[] = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'LOCKED',
  'PUBLISHED',
  'CANCELLED',
];

describe('run transitions', () => {
  it('walks the happy path end to end', () => {
    let status: RunStatus = 'DRAFT';
    for (const action of ['calculate', 'approve', 'lock', 'publish'] as RunAction[]) {
      const next = nextStatus(status, action);
      expect(next).not.toBeNull();
      status = next as RunStatus;
    }
    expect(status).toBe('PUBLISHED');
  });

  it('allows recalculating repeatedly while under review', () => {
    expect(nextStatus('IN_REVIEW', 'calculate')).toBe('IN_REVIEW');
  });

  it('reopens only from APPROVED', () => {
    expect(nextStatus('APPROVED', 'reopen')).toBe('IN_REVIEW');
    for (const status of ALL_STATUSES.filter((s) => s !== 'APPROVED')) {
      expect(canTransition(status, 'reopen')).toBe(false);
    }
  });

  it('never reopens or recalculates a locked or published run', () => {
    // The single most important rule here: a payslip an employee has seen
    // must not change underneath them.
    for (const status of ['LOCKED', 'PUBLISHED'] as RunStatus[]) {
      for (const action of ['calculate', 'reopen', 'approve', 'cancel'] as RunAction[]) {
        expect(canTransition(status, action)).toBe(false);
      }
    }
  });

  it('refuses every action on a cancelled run', () => {
    for (const action of ['calculate', 'approve', 'reopen', 'lock', 'publish'] as RunAction[]) {
      expect(canTransition('CANCELLED', action)).toBe(false);
    }
  });

  it('publishes only from LOCKED', () => {
    for (const status of ALL_STATUSES.filter((s) => s !== 'LOCKED')) {
      expect(canTransition(status, 'publish')).toBe(false);
    }
  });

  it('locks only from APPROVED — never straight from review', () => {
    expect(canTransition('IN_REVIEW', 'lock')).toBe(false);
    expect(canTransition('APPROVED', 'lock')).toBe(true);
  });

  it('returns null rather than throwing on an illegal transition', () => {
    expect(nextStatus('PUBLISHED', 'calculate')).toBeNull();
  });
});

describe('separation of duties', () => {
  it('requires the approver permission to approve, reopen and lock', () => {
    expect(RUN_ACTION_PERMISSION.approve).toBe('payroll.approve');
    expect(RUN_ACTION_PERMISSION.reopen).toBe('payroll.approve');
    expect(RUN_ACTION_PERMISSION.lock).toBe('payroll.approve');
  });

  it('requires only the processor permission to calculate and publish', () => {
    expect(RUN_ACTION_PERMISSION.calculate).toBe('payroll.process');
    expect(RUN_ACTION_PERMISSION.publish).toBe('payroll.process');
  });
});

describe('editability and visibility', () => {
  it('shows payslips to employees only once published', () => {
    for (const status of ALL_STATUSES) {
      expect(isPayslipVisibleToEmployee(status)).toBe(status === 'PUBLISHED');
    }
  });

  it('permits payment only once published', () => {
    for (const status of ALL_STATUSES) {
      expect(canPay(status)).toBe(status === 'PUBLISHED');
    }
  });
});

describe('payment transitions', () => {
  it('walks pending to paid', () => {
    expect(canTransitionPayment('PENDING', 'PROCESSING')).toBe(true);
    expect(canTransitionPayment('PROCESSING', 'PAID')).toBe(true);
  });

  it('retries a failed transfer', () => {
    expect(canTransitionPayment('PROCESSING', 'FAILED')).toBe(true);
    expect(canTransitionPayment('FAILED', 'PROCESSING')).toBe(true);
  });

  it('treats paid and cancelled as terminal', () => {
    const terminal: PaymentStatus[] = ['PAID', 'CANCELLED'];
    const every: PaymentStatus[] = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'];
    for (const from of terminal) {
      for (const to of every) expect(canTransitionPayment(from, to)).toBe(false);
    }
  });

  it('never jumps straight from pending to paid', () => {
    // Paying is a two-step so a bank file can be exported between them.
    expect(canTransitionPayment('PENDING', 'PAID')).toBe(false);
  });
});

describe('transitionError', () => {
  it('explains that a locked run is corrected in the next run', () => {
    expect(transitionError('LOCKED', 'calculate')).toContain('next run');
  });

  it('names the states an action is legal from', () => {
    expect(transitionError('DRAFT', 'publish')).toContain('LOCKED');
  });
});
