import { describe, expect, it } from 'vitest';
import { ROLE_OPTIONS, roleLabel } from './role-options';

describe('roleLabel', () => {
  it('names a system role', () => {
    expect(roleLabel('ADMIN')).toBe('Admin');
  });

  it('falls back to the code for a custom role', () => {
    // The regression this function exists for: ROLE_LABEL was a total Record
    // over an enum of the five system codes, so a custom code returned
    // undefined and rendered as the literal text "undefined".
    expect(roleLabel('IT_ADMIN')).toBe('IT_ADMIN');
  });

  it('prefers a supplied name over the raw code', () => {
    expect(roleLabel('IT_ADMIN', 'IT Admin')).toBe('IT Admin');
  });

  it('ignores a supplied name for a system role, so the vocabulary stays fixed', () => {
    expect(roleLabel('ADMIN', 'Something Else')).toBe('Admin');
  });

  it('renders an em dash when there is no role at all', () => {
    expect(roleLabel(null)).toBe('—');
    expect(roleLabel(undefined)).toBe('—');
  });

  it('never returns undefined for any system option', () => {
    for (const { value } of ROLE_OPTIONS) {
      expect(roleLabel(value)).toBeTruthy();
    }
  });
});
