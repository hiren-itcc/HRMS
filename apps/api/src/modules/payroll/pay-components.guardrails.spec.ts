import { COMPONENT_CODES } from '@hrms/shared';
import {
  deleteBlockedReason,
  editBlockedReason,
  isProtected,
  lockedFields,
  PROTECTED_CODES,
} from './pay-components.guardrails';

describe('isProtected', () => {
  it.each(Object.values(COMPONENT_CODES))(
    'protects %s — one of the codes the engine looks up',
    (code) => {
      expect(isProtected(code)).toBe(true);
    },
  );

  it('protects TDS specifically — the case an isStatutory guard would miss', () => {
    // TDS is isStatutory: false (deliberately — entered per employee rather
    // than projected) yet payroll.calc.ts and tds-returns.service.ts
    // hardcode it by code. A guard keyed on isStatutory would leave it
    // editable and deletable; this one is keyed on COMPONENT_CODES instead.
    expect(PROTECTED_CODES.has(COMPONENT_CODES.TDS)).toBe(true);
    expect(isProtected('TDS')).toBe(true);
  });

  it('leaves a user-created code unprotected', () => {
    expect(isProtected('SHIFT_ALLOWANCE')).toBe(false);
  });

  it('leaves a seeded-but-unreferenced code unprotected', () => {
    // HRA is seeded (isSystem: true) but never looked up by code — only the
    // eight COMPONENT_CODES entries are.
    expect(isProtected('HRA')).toBe(false);
  });
});

describe('lockedFields', () => {
  it('locks kind, taxable and isStatutory on a protected component', () => {
    expect(lockedFields({ code: 'BASIC' })).toEqual(['kind', 'taxable', 'isStatutory']);
  });

  it('locks the same fields on TDS', () => {
    expect(lockedFields({ code: 'TDS' })).toEqual(['kind', 'taxable', 'isStatutory']);
  });

  it('locks nothing on a user-created component', () => {
    expect(lockedFields({ code: 'SHIFT_ALLOWANCE' })).toEqual([]);
  });
});

describe('editBlockedReason', () => {
  const basic = { code: 'BASIC', kind: 'EARNING', taxable: true, isStatutory: false };
  const tds = { code: 'TDS', kind: 'DEDUCTION', taxable: false, isStatutory: false };

  it('rejects a kind change on a protected component', () => {
    expect(editBlockedReason(basic, { kind: 'DEDUCTION' })).toMatch(/kind/);
  });

  it('rejects a taxable change on TDS specifically — the case an isStatutory guard would miss', () => {
    expect(editBlockedReason(tds, { taxable: true })).toMatch(/taxable/);
  });

  it('rejects an isStatutory change on a protected component', () => {
    expect(editBlockedReason(basic, { isStatutory: true })).toMatch(/isStatutory/);
  });

  it('names every locked field that actually changed', () => {
    const reason = editBlockedReason(basic, { kind: 'DEDUCTION', taxable: false });
    expect(reason).toContain('kind');
    expect(reason).toContain('taxable');
    expect(reason).not.toContain('isStatutory');
  });

  it('allows a value that matches the current one — not a real change', () => {
    expect(editBlockedReason(basic, { kind: 'EARNING', taxable: true })).toBeNull();
  });

  it('never blocks a name-only edit — name is not a locked field', () => {
    expect(editBlockedReason(basic, {})).toBeNull();
  });

  it('leaves a user-created component fully editable', () => {
    const custom = { code: 'SHIFT_ALLOWANCE', kind: 'EARNING', taxable: true, isStatutory: false };
    expect(
      editBlockedReason(custom, { kind: 'DEDUCTION', taxable: false, isStatutory: true }),
    ).toBeNull();
  });
});

describe('deleteBlockedReason', () => {
  const zero = { structureLines: 0, adjustments: 0, expenseCategories: 0 };

  it('never allows deleting a protected component, even when unreferenced', () => {
    expect(deleteBlockedReason({ code: 'BASIC' }, zero)).toMatch(/cannot be deleted/);
  });

  it('protects TDS from deletion specifically', () => {
    expect(deleteBlockedReason({ code: 'TDS' }, zero)).not.toBeNull();
  });

  it('returns null for a user-created component with no references', () => {
    expect(deleteBlockedReason({ code: 'SHIFT_ALLOWANCE' }, zero)).toBeNull();
  });

  it('returns null only when all three counts are zero', () => {
    expect(
      deleteBlockedReason(
        { code: 'SHIFT_ALLOWANCE' },
        { structureLines: 1, adjustments: 0, expenseCategories: 0 },
      ),
    ).not.toBeNull();
    expect(
      deleteBlockedReason(
        { code: 'SHIFT_ALLOWANCE' },
        { structureLines: 0, adjustments: 1, expenseCategories: 0 },
      ),
    ).not.toBeNull();
    expect(
      deleteBlockedReason(
        { code: 'SHIFT_ALLOWANCE' },
        { structureLines: 0, adjustments: 0, expenseCategories: 1 },
      ),
    ).not.toBeNull();
    expect(deleteBlockedReason({ code: 'SHIFT_ALLOWANCE' }, zero)).toBeNull();
  });

  it('names each non-zero reference type separately, not as a bare total', () => {
    const reason = deleteBlockedReason(
      { code: 'SHIFT_ALLOWANCE' },
      { structureLines: 2, adjustments: 0, expenseCategories: 1 },
    );
    expect(reason).toContain('2 salary structures');
    expect(reason).toContain('1 expense category');
    expect(reason).not.toContain('adjustment');
  });

  it('pluralizes each reference type correctly at one', () => {
    const reason = deleteBlockedReason(
      { code: 'SHIFT_ALLOWANCE' },
      { structureLines: 1, adjustments: 1, expenseCategories: 1 },
    );
    expect(reason).toContain('1 salary structure');
    expect(reason).toContain('1 payroll adjustment');
    expect(reason).toContain('1 expense category');
    expect(reason).not.toMatch(/structures\b/);
    expect(reason).not.toMatch(/adjustments\b/);
  });

  it('offers deactivation as the remedy', () => {
    const reason = deleteBlockedReason(
      { code: 'SHIFT_ALLOWANCE' },
      { structureLines: 1, adjustments: 0, expenseCategories: 0 },
    );
    expect(reason).toMatch(/deactivate/i);
  });
});
