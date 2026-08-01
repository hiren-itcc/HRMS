import { employeeCreateSchema } from '@hrms/shared';

/*
 * An HTML form posts "" for every field the user did not touch. These assert
 * that "" reaches the service as absent rather than as an empty string.
 *
 * This is not hypothetical: `optionalStr` was written as
 * `trimmed(max).optional().or(z.literal('').transform(...))`, and because
 * `z.string().optional()` happily accepts "", the union never reached the
 * transform. An omitted employee code was stored as "" instead of being
 * auto-generated — and the second one collided on the unique index.
 */
const base = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  workEmail: 'ada@example.com',
  joinDate: '2026-08-01',
};

describe('employeeCreateSchema — blank form fields', () => {
  const parsed = employeeCreateSchema.parse({
    ...base,
    employeeCode: '',
    personalEmail: '',
    dateOfBirth: '',
    phone: '',
    addressLine: '',
    departmentId: '',
    managerId: '',
  });

  it('drops a blank employee code so the service can generate one', () => {
    expect(parsed.employeeCode).toBeUndefined();
  });

  it('drops blank optional strings rather than storing ""', () => {
    expect(parsed.personalEmail).toBeUndefined();
    expect(parsed.dateOfBirth).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
    expect(parsed.addressLine).toBeUndefined();
  });

  it('turns a blank relation id into null, never ""', () => {
    // "" would reach Prisma as a foreign key and fail at the database.
    expect(parsed.departmentId).toBeNull();
    expect(parsed.managerId).toBeNull();
  });

  it('still passes real values through untouched', () => {
    const real = employeeCreateSchema.parse({
      ...base,
      employeeCode: 'EMP-9999',
      departmentId: 'dep_1',
      personalEmail: 'ADA@Example.COM',
    });
    expect(real.employeeCode).toBe('EMP-9999');
    expect(real.departmentId).toBe('dep_1');
    expect(real.personalEmail).toBe('ada@example.com');
  });

  it('still rejects a genuinely invalid value', () => {
    expect(employeeCreateSchema.safeParse({ ...base, personalEmail: 'not-an-email' }).success).toBe(
      false,
    );
  });
});

describe('employeeCreateSchema — sign-in defaults', () => {
  it('creates a login by default', () => {
    // An employee record nobody can sign in as was the original bug; opting
    // out has to be deliberate.
    const parsed = employeeCreateSchema.parse(base);
    expect(parsed.createLogin).toBe(true);
    expect(parsed.loginRole).toBe('EMPLOYEE');
  });

  it('allows opting out', () => {
    expect(employeeCreateSchema.parse({ ...base, createLogin: false }).createLogin).toBe(false);
  });

  it('rejects a role that is not a system role', () => {
    expect(employeeCreateSchema.safeParse({ ...base, loginRole: 'SUPERUSER' }).success).toBe(false);
  });
});
