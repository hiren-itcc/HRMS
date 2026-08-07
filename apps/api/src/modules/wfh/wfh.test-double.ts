import type { WfhService } from './wfh.service';

/**
 * WFH stub for the attendance specs.
 *
 * Attendance asks this module exactly one question — which employee-days were
 * agreed in advance — so the double answers only that, and answers "none".
 * A day that reads `WFH` in those specs is therefore an unapproved one, which
 * is the case worth having as the default: the flag being wrong is a bug
 * somebody sees, and the flag being absent is not.
 *
 * Pass a set to exercise the other branch.
 */
export function wfhDouble(approved: Set<string> = new Set()): WfhService {
  return {
    approvedDaysIn: async () => approved,
  } as unknown as WfhService;
}
