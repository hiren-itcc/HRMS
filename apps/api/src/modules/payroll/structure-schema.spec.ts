import { salaryStructureCreateSchema, salaryStructureUpdateSchema } from '@hrms/shared';

/*
 * The structure editor (apps/web .../payroll/components/structure-form.tsx)
 * re-states these rules client-side so it can point at the offending row
 * instead of showing a flat 400. That mirror is only safe while it agrees with
 * the schema, so these lock the schema's side of the contract down.
 */
const line = (over: Partial<Record<string, unknown>> = {}) => ({
  componentId: 'cmp_basic',
  calcType: 'PERCENT_OF_CTC' as const,
  value: 40,
  order: 1,
  ...over,
});

const base = { name: 'Standard Staff', code: 'STD', lines: [line()] };

describe('salaryStructureCreateSchema', () => {
  it('accepts a minimal structure', () => {
    expect(salaryStructureCreateSchema.safeParse(base).success).toBe(true);
  });

  it('defaults isActive to true — a new structure is usable immediately', () => {
    const parsed = salaryStructureCreateSchema.parse(base);
    expect(parsed.isActive).toBe(true);
  });

  it.each([
    ['lower case', 'std'],
    ['a hyphen', 'STD-1'],
    ['a space', 'STD 1'],
  ])('rejects a code containing %s', (_label, code) => {
    expect(salaryStructureCreateSchema.safeParse({ ...base, code }).success).toBe(false);
  });

  it('accepts capitals, digits and underscores', () => {
    expect(salaryStructureCreateSchema.safeParse({ ...base, code: 'STD_2026' }).success).toBe(true);
  });

  it('requires at least one line — an empty structure calculates nothing', () => {
    expect(salaryStructureCreateSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it('allows exactly one BALANCE line', () => {
    const lines = [line(), line({ componentId: 'cmp_special', calcType: 'BALANCE', value: 0 })];
    expect(salaryStructureCreateSchema.safeParse({ ...base, lines }).success).toBe(true);
  });

  it('rejects two BALANCE lines — the second would silently resolve to zero', () => {
    const lines = [
      line({ componentId: 'cmp_a', calcType: 'BALANCE', value: 0 }),
      line({ componentId: 'cmp_b', calcType: 'BALANCE', value: 0 }),
    ];
    const result = salaryStructureCreateSchema.safeParse({ ...base, lines });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('absorb the balance');
  });

  it('rejects the same component twice', () => {
    const lines = [line(), line({ calcType: 'FLAT', value: 100 })];
    const result = salaryStructureCreateSchema.safeParse({ ...base, lines });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('only appear once');
  });
});

describe('salaryStructureUpdateSchema', () => {
  it('allows a partial edit that touches nothing but isActive', () => {
    // This is the path that makes "deactivate it instead of deleting" reachable.
    const result = salaryStructureUpdateSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });

  it('still enforces the line rules when lines are supplied', () => {
    const lines = [
      line({ componentId: 'cmp_a', calcType: 'BALANCE', value: 0 }),
      line({ componentId: 'cmp_b', calcType: 'BALANCE', value: 0 }),
    ];
    expect(salaryStructureUpdateSchema.safeParse({ lines }).success).toBe(false);
  });
});
