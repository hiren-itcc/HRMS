import { ASSET_MANUAL_STATUSES, ASSET_STATUSES, type AssetStatusCode } from '@hrms/shared';
import {
  canIssue,
  canReturn,
  canSetStatus,
  issueError,
  returnError,
  statusChangeError,
} from './asset.status';

const OTHERS = (except: AssetStatusCode[]) => ASSET_STATUSES.filter((s) => !except.includes(s));

describe('canIssue', () => {
  it('lets an asset in stock go out', () => {
    expect(canIssue('IN_STOCK')).toBe(true);
  });

  it.each(OTHERS(['IN_STOCK']))('refuses a %s asset', (status) => {
    expect(canIssue(status)).toBe(false);
  });

  /* A refusal nobody can act on is a refusal that gets worked around. */
  it.each(OTHERS(['IN_STOCK']))('says what is wrong with a %s asset', (status) => {
    expect(issueError(status)).not.toBe('This cannot be issued');
  });
});

describe('canReturn', () => {
  it('takes back what is out', () => {
    expect(canReturn('ASSIGNED')).toBe(true);
  });

  it.each(OTHERS(['ASSIGNED']))('refuses a %s asset', (status) => {
    expect(canReturn(status)).toBe(false);
  });

  it('says nobody is holding one that is in stock', () => {
    expect(returnError('IN_STOCK')).toBe('Nobody is holding this');
  });
});

describe('canSetStatus', () => {
  it('sends one in stock for repair, and brings it back', () => {
    expect(canSetStatus('IN_STOCK', 'IN_REPAIR')).toBe(true);
    expect(canSetStatus('IN_REPAIR', 'IN_STOCK')).toBe(true);
  });

  /*
   * The rule and the schema the route validates against have to agree. They did
   * not: `IN_STOCK` was missing from ASSET_MANUAL_STATUSES, so repair was a
   * dead end and the refusal on issuing an in-repair asset — "put it back in
   * stock before issuing it" — was advice the API made impossible to follow.
   */
  it('accepts every status the rules allow somebody to set by hand', () => {
    const settable = new Set<string>(ASSET_MANUAL_STATUSES);
    for (const to of ASSET_STATUSES) {
      const reachable = ASSET_STATUSES.some((from) => canSetStatus(from, to));
      // ASSIGNED is reached by issuing, never by typing it.
      if (reachable && to !== 'ASSIGNED') {
        expect(settable.has(to)).toBe(true);
      }
    }
  });

  it('still refuses to put a held asset back in stock behind a return', () => {
    expect(canSetStatus('ASSIGNED', 'IN_STOCK')).toBe(false);
  });

  it('retires one nobody is holding', () => {
    expect(canSetStatus('IN_STOCK', 'RETIRED')).toBe(true);
  });

  /*
   * The asymmetry worth naming. Both mean the company has it back, and the
   * company does not — a register that let you retire a laptop out of
   * somebody's bag would be lying about where it is.
   */
  it('refuses repair and retirement while somebody is holding it', () => {
    expect(canSetStatus('ASSIGNED', 'IN_REPAIR')).toBe(false);
    expect(canSetStatus('ASSIGNED', 'RETIRED')).toBe(false);
    expect(statusChangeError('ASSIGNED', 'RETIRED')).toMatch(/take it back/);
  });

  /*
   * And the exception that proves it. "It is gone" is exactly the case where
   * you cannot take it back first; refusing would leave the register insisting
   * an employee still carries a laptop everybody agrees no longer exists.
   */
  it('lets one be written off as lost while it is still out', () => {
    expect(canSetStatus('ASSIGNED', 'LOST')).toBe(true);
  });

  it('will not resurrect a retired asset', () => {
    for (const to of OTHERS(['RETIRED'])) {
      expect(canSetStatus('RETIRED', to)).toBe(false);
    }
    expect(statusChangeError('RETIRED', 'IN_STOCK')).toBe('This was retired');
  });

  it('is not a transition to the state it is already in', () => {
    for (const status of ASSET_STATUSES) {
      expect(canSetStatus(status, status)).toBe(false);
    }
    expect(statusChangeError('LOST', 'LOST')).toBe('This is already lost');
  });

  /* Reads as a sentence, not as an enum member — and the readable forms do
     not all take the same article, hence "Something", not "A". */
  it('names statuses the way a person would', () => {
    expect(statusChangeError('IN_REPAIR', 'ASSIGNED')).toBe(
      'Something in repair cannot be marked issued',
    );
  });
});
