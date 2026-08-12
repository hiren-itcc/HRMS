import { employeeCreateSchema, employeeUpdateSchema } from '@hrms/shared';

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
/** The minimum a valid employee needs — job details included, since they are required. */
const base = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  workEmail: 'ada@example.com',
  joinDate: '2026-08-01',
  departmentId: 'dep_1',
  designationId: 'des_1',
  locationId: 'loc_1',
  shiftId: 'shift_1',
  employmentTypeId: 'et_1',
};

describe('employeeCreateSchema — blank form fields', () => {
  const parsed = employeeCreateSchema.parse({
    ...base,
    employeeCode: '',
    personalEmail: '',
    dateOfBirth: '',
    phone: '',
    addressLine: '',
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

  it('turns a blank optional relation into null, never ""', () => {
    // "" would reach Prisma as a foreign key and fail at the database.
    // Manager is the only relation that may legitimately be empty.
    expect(parsed.managerId).toBeNull();
  });

  it('still passes real values through untouched', () => {
    const real = employeeCreateSchema.parse({
      ...base,
      employeeCode: 'EMP-9999',
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

  /*
   * The schema validates the *shape* of a role code, not membership of a fixed
   * list. It used to be an enum of the five seeded codes, which meant a custom
   * role composed in Settings → Roles could be created and then assigned to
   * nobody. Existence is checked where it can actually be known — against the
   * caller's organization in `EmployeesService.changeRole`, which answers
   * "Role X does not exist".
   */
  it('accepts a custom role code, because custom roles exist now', () => {
    expect(employeeCreateSchema.safeParse({ ...base, loginRole: 'IT_ADMIN' }).success).toBe(true);
  });

  it('still rejects a malformed code', () => {
    for (const loginRole of ['lowercase', 'HAS SPACE', '1LEADING', 'THIS_CODE_IS_FAR_TOO_LONG']) {
      expect(employeeCreateSchema.safeParse({ ...base, loginRole }).success).toBe(false);
    }
  });
});

describe('employeeCreateSchema — job details', () => {
  const job = {
    departmentId: 'dep_1',
    designationId: 'des_1',
    locationId: 'loc_1',
    shiftId: 'shift_1',
    employmentTypeId: 'et_1',
  };

  it('accepts a complete record with no manager', () => {
    // Somebody has to be at the top of the org chart, and the first employee
    // in a new organization has nobody to point at.
    const parsed = employeeCreateSchema.parse(base);
    expect(parsed.managerId).toBeUndefined();
    expect(parsed.departmentId).toBe('dep_1');
  });

  it('rejects each job field when it is missing', () => {
    for (const field of Object.keys(job)) {
      const without = { ...base } as Record<string, unknown>;
      delete without[field];
      const result = employeeCreateSchema.safeParse(without);
      expect(result.success).toBe(false);
    }
  });

  it('rejects a blank select rather than storing ""', () => {
    const result = employeeCreateSchema.safeParse({ ...base, departmentId: '' });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('Department is required');
  });

  it('names the field that is missing', () => {
    const result = employeeCreateSchema.safeParse({ ...base, shiftId: '' });
    expect(JSON.stringify(result.error?.issues)).toContain('Shift is required');
  });

  it('still allows a partial edit that does not touch job details', () => {
    // employeeUpdateSchema is .partial(), so a PATCH of one field stays legal.
    expect(employeeUpdateSchema.safeParse({ phone: '+91 90000 00000' }).success).toBe(true);
  });
});
