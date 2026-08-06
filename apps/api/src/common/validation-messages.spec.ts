/*
 * These live here, not in packages/shared, because that package ships no test
 * runner — and because the API is one of the two things the map has to be
 * right for: `http-exception.filter.ts` puts these very sentences in the
 * `details` of a 400, so a client reads them without ever opening a form.
 */

import { employeeCreateSchema, fieldLabel, installValidationMessages } from '@hrms/shared';
import { z } from 'zod';

installValidationMessages();

/** The first message for a path, which is what a form field displays. */
function messageFor(schema: z.ZodType, value: unknown, path: string): string | undefined {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.join('.') === path)?.message;
}

describe('fieldLabel', () => {
  it('reads a camelCase key as a sentence, not a heading', () => {
    expect(fieldLabel('firstName')).toBe('First name');
    expect(fieldLabel('emergencyContacts')).toBe('Emergency contacts');
  });

  /* A splitter turns ifscCode into "Ifsc code", which is not a word. */
  it('keeps acronyms as acronyms', () => {
    expect(fieldLabel('ifscCode')).toBe('IFSC code');
    expect(fieldLabel('monthlyCtc')).toBe('Monthly CTC');
  });

  /*
   * An id names a thing, and the user picked the thing, not the id.
   * "Leave type is required" beats "Leave type id is required".
   */
  it('names what an id points at', () => {
    expect(fieldLabel('leaveTypeId')).toBe('Leave type');
    expect(fieldLabel('managerId')).toBe('Reporting manager');
  });
});

describe('the message map', () => {
  it('says a missing field is required, not that it is undefined', () => {
    const schema = z.object({ firstName: z.string() });
    expect(messageFor(schema, {}, 'firstName')).toBe('First name is required');
  });

  /*
   * `.min(1)` on a string is how a required text field is written; it is not
   * a length rule and should not read like one.
   */
  it('treats a one-character minimum as required, not as a length', () => {
    const schema = z.object({ bankName: z.string().min(1) });
    expect(messageFor(schema, { bankName: '' }, 'bankName')).toBe('Bank name is required');
  });

  it('states a real length rule in characters', () => {
    const schema = z.object({ code: z.string().min(3).max(8) });
    expect(messageFor(schema, { code: 'a' }, 'code')).toBe('Code must be at least 3 characters');
    expect(messageFor(schema, { code: 'abcdefghi' }, 'code')).toBe(
      'Code must be 8 characters or fewer',
    );
  });

  it('asks for a choice when a value is not one of the options', () => {
    const schema = z.object({ status: z.enum(['DRAFT', 'PAID']) });
    expect(messageFor(schema, { status: 'NOPE' }, 'status')).toBe('Choose a valid status');
  });

  it('names the format rather than the pattern', () => {
    const schema = z.object({ workEmail: z.email() });
    expect(messageFor(schema, { workEmail: 'nope' }, 'workEmail')).toBe(
      'Enter a valid email address',
    );
  });

  it('says whole number rather than "expected int"', () => {
    const schema = z.object({ noticePeriodDays: z.number().int() });
    expect(messageFor(schema, { noticePeriodDays: 1.5 }, 'noticePeriodDays')).toBe(
      'Notice period days must be a whole number',
    );
  });

  /* An array path ends in an index; "0 is required" helps nobody. */
  it('names the property, not the array index', () => {
    const schema = z.object({
      emergencyContacts: z.array(z.object({ name: z.string().min(1) })),
    });
    expect(
      messageFor(schema, { emergencyContacts: [{ name: '' }] }, 'emergencyContacts.0.name'),
    ).toBe('Name is required');
  });

  /*
   * The property that makes the map safe to add at all: 62 messages were
   * written by hand across these schemas, and every one of them must survive.
   */
  it('never overrides a message the schema author wrote', () => {
    const schema = z.object({ city: z.string().min(1, 'Where do they work?') });
    expect(messageFor(schema, { city: '' }, 'city')).toBe('Where do they work?');
  });

  /* Against a real schema, not a fixture built to pass. */
  it('improves a real form: employeeCreateSchema with an empty body', () => {
    const result = employeeCreateSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    for (const issue of result.error.issues) {
      expect(issue.message).not.toMatch(/expected|received|Invalid input|Too small|Too big/);
    }
  });
});
