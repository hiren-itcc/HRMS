import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isRequiredField, schemaAt } from './zod-field';

const schema = z
  .object({
    firstName: z.string().min(1),
    middleName: z.string().optional(),
    managerId: z.string().nullable(),
    noticeDays: z.number().default(30),
    contacts: z.array(z.object({ name: z.string().min(1), note: z.string().optional() })),
    address: z.object({ city: z.string().min(1) }),
  })
  // Most create schemas carry a cross-field rule; in zod 4 that wraps the
  // object in a pipe, so this is the shape the walker actually meets.
  .refine(() => true, { message: 'never fires' });

describe('isRequiredField', () => {
  it('marks a plain constrained field required', () => {
    expect(isRequiredField(schema, 'firstName')).toBe(true);
  });

  it('leaves an optional field unmarked', () => {
    expect(isRequiredField(schema, 'middleName')).toBe(false);
  });

  /*
   * The half that `isOptional()` alone gets wrong. A nullable select is one
   * the form may leave empty — "no manager" is an answer — so an asterisk
   * there would be a lie on every such field in the app.
   */
  it('treats nullable as not required', () => {
    expect(isRequiredField(schema, 'managerId')).toBe(false);
  });

  /* A default means the user need not supply anything. */
  it('treats a defaulted field as not required', () => {
    expect(isRequiredField(schema, 'noticeDays')).toBe(false);
  });

  it('walks into an array row', () => {
    expect(isRequiredField(schema, 'contacts.0.name')).toBe(true);
    expect(isRequiredField(schema, 'contacts.0.note')).toBe(false);
  });

  it('walks into a nested object', () => {
    expect(isRequiredField(schema, 'address.city')).toBe(true);
  });

  /*
   * The failure mode that matters: a name that does not match the schema is a
   * bug worth finding, but it must not take the form down on render.
   */
  it('returns false for a path the schema does not have', () => {
    expect(isRequiredField(schema, 'nope')).toBe(false);
    expect(isRequiredField(schema, 'address.nope.deeper')).toBe(false);
    expect(isRequiredField(schema, 'firstName.somehow.deeper')).toBe(false);
  });

  it('returns false rather than throwing without a schema', () => {
    expect(isRequiredField(undefined, 'firstName')).toBe(false);
    expect(isRequiredField(schema, '')).toBe(false);
  });
});

describe('schemaAt', () => {
  it('returns the field still wrapped, because the wrapper is the answer', () => {
    const field = schemaAt(schema, 'middleName');
    expect(field).toBeDefined();
    expect(field?.isOptional()).toBe(true);
  });

  it('reaches through the refine wrapper on the object', () => {
    expect(schemaAt(schema, 'firstName')).toBeDefined();
  });
});
