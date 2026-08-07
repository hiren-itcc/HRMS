import { z } from 'zod';

/**
 * One place where a validation failure becomes a sentence.
 *
 * Zod's own messages are written for whoever is holding the stack trace:
 * "Invalid input: expected string, received undefined", "Too small: expected
 * string to have >=1 characters", `Invalid option: expected one of
 * "DRAFT"|"PAID"`. Those reached users, on 192 of the 254 constraints in this
 * directory — every one that had not been given a message by hand.
 *
 * Writing 192 more strings would have fixed today and nothing after it: the
 * next field somebody adds falls back to the default again. A map fixes the
 * default itself, so a new field starts out saying something useful.
 *
 * **A message written on the schema still wins.** Zod consults this only where
 * a constraint carries none, so the 62 hand-written ones are untouched and
 * anything sharper than what is below belongs on the field, not here.
 *
 * It is registered globally, and there is only one copy of zod across
 * `packages/shared`, `apps/web` and `apps/api` — so this is also what the API
 * puts in the `details` of a 400, and the form and the server say the same
 * thing about the same field.
 */

/**
 * Words a camelCase splitter gets wrong. Everything else derives, so this
 * stays short: it is for acronyms and initialisms, not for taste.
 */
const LABELS: Record<string, string> = {
  ctc: 'CTC',
  ifscCode: 'IFSC code',
  monthlyCtc: 'Monthly CTC',
  panNumber: 'PAN number',
  tds: 'TDS',
  monthlyTds: 'Monthly TDS',
  url: 'URL',
  avatarUrl: 'Avatar URL',
  dob: 'Date of birth',
  hra: 'HRA',
  pf: 'PF',
  esi: 'ESI',
  id: 'ID',
  employeeId: 'Employee',
  leaveTypeId: 'Leave type',
  departmentId: 'Department',
  designationId: 'Designation',
  locationId: 'Location',
  managerId: 'Reporting manager',
  shiftId: 'Shift',
  employmentTypeId: 'Employment type',
  categoryId: 'Category',
  structureId: 'Salary structure',
  componentId: 'Component',
};

/**
 * `firstName` → "First name". Deliberately sentence case, not title case: the
 * message reads as a sentence and "First Name Is Required" does not.
 */
export function fieldLabel(key: string): string {
  const override = LABELS[key];
  if (override) return override;
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return spaced ? spaced[0]?.toUpperCase() + spaced.slice(1) : 'This field';
}

/**
 * The name to put in the sentence.
 *
 * An array path ends in an index — `emergencyContacts.0.name` is fine, but
 * `emergencyContacts.0` would produce "0 is required", so the index is skipped
 * and the property before it used instead.
 */
function labelFor(path: readonly PropertyKey[] | undefined): string {
  if (!path?.length) return 'This field';
  for (let i = path.length - 1; i >= 0; i--) {
    const part = path[i];
    if (typeof part === 'string' && !/^\d+$/.test(part)) return fieldLabel(part);
  }
  return 'This field';
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What a bad value of each format should say. */
const FORMAT_MESSAGES: Record<string, string> = {
  email: 'Enter a valid email address',
  url: 'Enter a valid web address',
  uuid: 'That is not a valid identifier',
  date: 'Use the date picker, or type the date as YYYY-MM-DD',
  time: 'Use a 24-hour time, like 09:30',
  datetime: 'That is not a valid date and time',
};

export function validationMessage(issue: z.core.$ZodRawIssue): string | undefined {
  const name = labelFor(issue.path);

  switch (issue.code) {
    /*
     * Nothing was sent at all. Zod reports this as a type error against
     * `undefined`, which is true and useless — for a form it means the person
     * left the field alone.
     */
    case 'invalid_type': {
      if (issue.input === undefined || issue.input === null) return `${name} is required`;
      if (issue.expected === 'int') return `${name} must be a whole number`;
      if (issue.expected === 'number') return `${name} must be a number`;
      if (issue.expected === 'date') return `${name} is not a valid date`;
      return `${name} is not valid`;
    }

    case 'too_small': {
      const min = Number(issue.minimum);
      // A one-character minimum on a string is not a length rule, it is how a
      // required text field is written.
      if (issue.origin === 'string') {
        return min <= 1
          ? `${name} is required`
          : `${name} must be at least ${plural(min, 'character')}`;
      }
      if (issue.origin === 'array') {
        return min <= 1 ? `Add at least one` : `Add at least ${min}`;
      }
      return `${name} must be ${min} or more`;
    }

    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') return `${name} must be ${plural(max, 'character')} or fewer`;
      if (issue.origin === 'array') return `No more than ${max}`;
      return `${name} must be ${max} or less`;
    }

    /* An enum or literal the value is not one of. */
    case 'invalid_value':
      return `Choose a valid ${fieldLabel(String(issue.path?.at(-1) ?? '')).toLowerCase()}`;

    case 'invalid_format': {
      const known = FORMAT_MESSAGES[String(issue.format)];
      if (known) return known;
      // A bare regex has no name a user would recognise, so say what to fix
      // rather than what the pattern was.
      return `${name} is not in the right format`;
    }

    case 'not_multiple_of':
      return `${name} must be a multiple of ${issue.divisor}`;

    case 'unrecognized_keys':
      return 'Some of what was sent is not expected here';

    /*
     * Everything else — invalid_union, custom checks, and anything zod adds
     * later. Returning undefined falls through to zod's own message, which is
     * the honest answer when this map has nothing better to say. A `.refine()`
     * without a message is the author's omission, not something to paper over
     * with a guess.
     */
    default:
      return undefined;
  }
}

/**
 * Registered once, from `index.ts`, so importing any schema installs it before
 * the first parse.
 */
export function installValidationMessages(): void {
  z.config({ customError: (issue) => validationMessage(issue) });
}
