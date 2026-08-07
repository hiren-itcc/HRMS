import {
  acceptsApplications,
  canCloseOpening,
  canMoveStage,
  canRaiseOffer,
  canRespondToOffer,
  isTerminal,
} from './application.stage';

const move = (
  from: Parameters<typeof canMoveStage>[0]['from'],
  to: Parameters<typeof canMoveStage>[0]['to'],
  hasAcceptedOffer = false,
) => canMoveStage({ from, to, hasAcceptedOffer });

describe('moving through the pipeline', () => {
  it('goes forward one stage at a time', () => {
    expect(move('APPLIED', 'SCREENING').ok).toBe(true);
    expect(move('SCREENING', 'INTERVIEW').ok).toBe(true);
    expect(move('INTERVIEW', 'OFFER').ok).toBe(true);
  });

  /*
   * Skipping is how a funnel starts reporting a lie — a candidate who was
   * never screened counts as screened, and the drop-off between stages stops
   * meaning anything.
   */
  it('refuses to skip a stage, and says which one comes next', () => {
    const verdict = move('APPLIED', 'INTERVIEW');
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('Screening');
  });

  /*
   * Backwards *is* allowed inside the pipeline. A round gets rescheduled, a
   * second opinion is wanted; that is ordinary, and refusing it would only
   * teach people to reject and re-add the candidate.
   */
  it('allows a step back while the application is live', () => {
    expect(move('INTERVIEW', 'SCREENING').ok).toBe(true);
    expect(move('OFFER', 'INTERVIEW').ok).toBe(true);
  });

  it('can always be rejected or withdrawn while live', () => {
    expect(move('APPLIED', 'REJECTED').ok).toBe(true);
    expect(move('OFFER', 'WITHDRAWN').ok).toBe(true);
  });

  it('says nothing changed when the stage is the one it is already at', () => {
    expect(move('SCREENING', 'SCREENING').ok).toBe(false);
  });
});

describe('endings', () => {
  it.each(['HIRED', 'REJECTED', 'WITHDRAWN'] as const)('%s is terminal', (stage) => {
    expect(isTerminal(stage)).toBe(true);
  });

  /*
   * The history has to say two things happened rather than pretend one did.
   * Reviving a rejection in place would erase that somebody was turned down.
   */
  it('refuses to revive a rejected application', () => {
    const verdict = move('REJECTED', 'SCREENING');
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('Start a new one');
  });

  it('refuses to move somebody who has already been hired', () => {
    const verdict = move('HIRED', 'OFFER');
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('already been hired');
  });
});

describe('hiring', () => {
  /*
   * The rule the module exists to protect: HIRED creates a login, a payroll
   * subject and an onboarding record. It may only be reached from an offer
   * somebody actually accepted.
   */
  it('refuses HIRED without an accepted offer', () => {
    const verdict = move('OFFER', 'HIRED', false);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('not been accepted');
  });

  it('allows HIRED once the offer is accepted', () => {
    expect(move('OFFER', 'HIRED', true).ok).toBe(true);
  });

  /* Even with an accepted offer somehow attached, the stage has to be right. */
  it('refuses HIRED from anywhere but the offer stage', () => {
    const verdict = move('INTERVIEW', 'HIRED', true);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('offer stage');
  });
});

describe('raising an offer', () => {
  it('needs the application at the offer stage', () => {
    expect(canRaiseOffer('OFFER').ok).toBe(true);
    const verdict = canRaiseOffer('SCREENING');
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('Screening');
  });
});

describe('responding to an offer', () => {
  it('refuses a reply to an offer nobody has sent', () => {
    expect(canRespondToOffer('DRAFT').ok).toBe(false);
  });

  it('accepts a reply to a sent offer', () => {
    expect(canRespondToOffer('SENT').ok).toBe(true);
  });

  it.each(['ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'] as const)(
    'refuses a second reply to an offer that is already %s',
    (status) => {
      expect(canRespondToOffer(status).ok).toBe(false);
    },
  );
});

describe('closing an opening', () => {
  it('closes when nothing is live', () => {
    expect(canCloseOpening(0).ok).toBe(true);
  });

  /*
   * Closing over live applications would leave candidates pointing at a dead
   * opening — a state nobody chose and somebody discovers weeks later.
   */
  it('refuses while applications are live, and offers the alternative', () => {
    const verdict = canCloseOpening(3);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('3 applications are still open');
    expect(verdict.ok === false && verdict.reason).toContain('on hold');
  });

  it('counts one application in the singular', () => {
    const verdict = canCloseOpening(1);
    expect(verdict.ok === false && verdict.reason).toContain('1 application is still open');
  });
});

describe('whether an opening takes applications', () => {
  it('takes them when open', () => {
    expect(acceptsApplications('OPEN').ok).toBe(true);
  });

  /* A draft collecting candidates is a surprise nobody wants to find later. */
  it.each(['DRAFT', 'ON_HOLD', 'CLOSED', 'FILLED'] as const)('refuses when %s', (status) => {
    expect(acceptsApplications(status).ok).toBe(false);
  });

  it('explains a draft rather than just refusing', () => {
    const verdict = acceptsApplications('DRAFT');
    expect(verdict.ok === false && verdict.reason).toContain('Publish it');
  });
});
