import type { AssetStatusCode } from '@hrms/shared';

/**
 * What may happen to an asset in each state. Pure, like
 * `settlement.workflow.ts` and `lifecycle.rules.ts` — "can this be issued" is
 * a question that should be answerable without a database.
 *
 * The machine is deliberately small, because `IN_STOCK` and `ASSIGNED` are not
 * really states somebody *sets*: they are what issuing and returning mean.
 * Only the other three are typed by a human, and each of those needs a reason.
 */

/** Only an asset in stock can go out. */
export function canIssue(status: AssetStatusCode): boolean {
  return status === 'IN_STOCK';
}

export function issueError(status: AssetStatusCode): string {
  switch (status) {
    case 'ASSIGNED':
      return 'This is already issued to somebody — take it back first';
    case 'IN_REPAIR':
      return 'This is in repair. Put it back in stock before issuing it';
    case 'LOST':
      return 'This was written off as lost';
    case 'RETIRED':
      return 'This was retired';
    default:
      return 'This cannot be issued';
  }
}

export function canReturn(status: AssetStatusCode): boolean {
  return status === 'ASSIGNED';
}

export function returnError(status: AssetStatusCode): string {
  return status === 'IN_STOCK'
    ? 'Nobody is holding this'
    : `A ${status.toLowerCase().replace('_', ' ')} asset cannot be returned`;
}

/**
 * The statuses a person sets by hand, and when.
 *
 * `LOST` is the one that may be set while somebody still holds it, and that
 * asymmetry is the whole reason this is a function rather than a set. "It is
 * gone" is precisely the case where you cannot take it back first — refusing
 * it would leave the register insisting an employee is still carrying a laptop
 * everybody agrees no longer exists. Setting it closes the open assignment.
 *
 * `IN_REPAIR` and `RETIRED` are refused while it is out, because both mean the
 * company has it and the company does not.
 */
export function canSetStatus(from: AssetStatusCode, to: AssetStatusCode): boolean {
  if (from === to) return false;
  // Terminal, the way a paid settlement is. Something disposed of does not come
  // back into stock; a replacement is a new row with its own tag and history.
  if (from === 'RETIRED') return false;
  if (to === 'LOST') return true;
  if (from === 'ASSIGNED') return false;
  return to === 'IN_REPAIR' || to === 'RETIRED' || to === 'IN_STOCK';
}

const READABLE: Record<AssetStatusCode, string> = {
  IN_STOCK: 'in stock',
  ASSIGNED: 'issued',
  IN_REPAIR: 'in repair',
  LOST: 'lost',
  RETIRED: 'retired',
};

export function statusChangeError(from: AssetStatusCode, to: AssetStatusCode): string {
  if (from === to) return `This is already ${READABLE[to]}`;
  if (from === 'RETIRED') return 'This was retired';
  if (from === 'ASSIGNED') {
    return `Somebody is still holding this — take it back before marking it ${READABLE[to]}`;
  }
  // "Something in repair", not "A in repair asset" — the readable forms do not
  // all take the same article.
  return `Something ${READABLE[from]} cannot be marked ${READABLE[to]}`;
}
