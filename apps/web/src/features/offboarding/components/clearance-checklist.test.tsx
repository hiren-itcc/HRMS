import { describe, expect, it } from 'vitest';
import type { OffboardingTask } from '../api';
import { clearanceProgress } from './clearance-checklist';

const task = (over: Partial<OffboardingTask>): OffboardingTask => ({
  id: 't',
  label: 'Return company assets',
  description: null,
  owner: 'IT_ADMIN',
  required: true,
  order: 0,
  status: 'PENDING',
  note: null,
  doneAt: null,
  doneById: null,
  ...over,
});

describe('clearanceProgress', () => {
  /*
   * Counts what the API's completion gate counts, and nothing else — a
   * progress figure that disagreed with the rule blocking the button would be
   * worse than no figure.
   */
  it('counts only required items', () => {
    expect(
      clearanceProgress([
        task({ id: 'a', required: true, status: 'DONE' }),
        task({ id: 'b', required: false, status: 'PENDING' }),
      ]),
    ).toEqual({ done: 1, total: 1 });
  });

  /* A waiver settles an item as surely as clearing it does. */
  it('treats NOT_APPLICABLE as settled', () => {
    expect(
      clearanceProgress([
        task({ id: 'a', status: 'DONE' }),
        task({ id: 'b', status: 'NOT_APPLICABLE' }),
        task({ id: 'c', status: 'PENDING' }),
      ]),
    ).toEqual({ done: 2, total: 3 });
  });

  it('is zero of zero when nothing is required', () => {
    expect(clearanceProgress([task({ required: false })])).toEqual({ done: 0, total: 0 });
    expect(clearanceProgress([])).toEqual({ done: 0, total: 0 });
  });
});
