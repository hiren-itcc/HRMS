import { clockInSchema, clockOutSchema } from '@hrms/shared';

/**
 * The position requirement lives in the schema, so this is where it is proved.
 * The service deliberately does not re-check it: validation belongs at the
 * edge here as it does everywhere else in this codebase.
 */
const AT_OFFICE = { latitude: 23.0225, longitude: 72.5714, accuracyMeters: 20 };

describe.each([
  ['clockInSchema', clockInSchema],
  ['clockOutSchema', clockOutSchema],
])('%s', (_name, schema) => {
  it('accepts a whole position', () => {
    expect(schema.safeParse(AT_OFFICE).success).toBe(true);
  });

  it('refuses a punch that carries no position and no reason', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/Location is required/);
  });

  it('accepts a punch that says the position could not be obtained', () => {
    // The browser could not even ask — no HTTPS, or no geolocation at all.
    // That is not something the person can fix, so it is not held against them.
    expect(schema.safeParse({ locationUnavailable: true }).success).toBe(true);
  });

  it('refuses half a position, which cannot be judged', () => {
    const result = schema.safeParse({ latitude: 23.0225, longitude: 72.5714 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/together/);
  });

  it('refuses coordinates outside the world', () => {
    expect(schema.safeParse({ ...AT_OFFICE, latitude: 120 }).success).toBe(false);
    expect(schema.safeParse({ ...AT_OFFICE, longitude: -200 }).success).toBe(false);
  });

  it('does not accept a declared work mode — the position decides', () => {
    const result = schema.safeParse({ ...AT_OFFICE, workMode: 'OFFICE' });
    // Zod strips unknown keys rather than failing, so assert it is not carried.
    expect(result.success).toBe(true);
    expect(result.data as Record<string, unknown>).not.toHaveProperty('workMode');
  });
});
