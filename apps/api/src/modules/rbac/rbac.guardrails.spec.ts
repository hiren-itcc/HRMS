import {
  applyGuardrails,
  deleteBlockedReason,
  editBlockedReason,
  lockoutReason,
  type RoleGrants,
  roleMoveLockoutReason,
} from './rbac.guardrails';

const FLOOR = ['settings.manage', 'role.manage'];

function roles(over: Partial<Record<string, Partial<RoleGrants>>> = {}): RoleGrants[] {
  const base: RoleGrants[] = [
    { id: 'admin', code: 'ADMIN', userCount: 1, permissions: [...FLOOR, 'report.export'] },
    { id: 'hr', code: 'HR', userCount: 2, permissions: ['leave.manage', 'report.view'] },
    { id: 'emp', code: 'EMPLOYEE', userCount: 8, permissions: ['leave.read.own'] },
  ];
  return base.map((r) => ({ ...r, ...(over[r.id] ?? {}) }));
}

describe('lockoutReason', () => {
  it('blocks the last holder of a floor permission from losing it', () => {
    expect(lockoutReason(roles(), 'admin', ['report.export'])).toMatch(/lock everyone out/);
  });

  it('names the permission that would be lost', () => {
    expect(lockoutReason(roles(), 'admin', ['role.manage'])).toContain('settings.manage');
  });

  it('allows the edit when another staffed role still holds the floor', () => {
    const withBackup = roles({ hr: { permissions: ['leave.manage', ...FLOOR] } });
    expect(lockoutReason(withBackup, 'admin', ['report.export'])).toBeNull();
  });

  it('ignores a role nobody holds — an empty ADMIN is not a safety net', () => {
    const emptyAdmin = roles({
      admin: { userCount: 0 },
      hr: { permissions: ['leave.manage', ...FLOOR] },
    });
    // HR is the only *staffed* holder, so HR may not drop it.
    expect(lockoutReason(emptyAdmin, 'hr', ['leave.manage'])).toMatch(/lock everyone out/);
  });

  it('protects a non-ADMIN role when it is the only staffed holder', () => {
    const hrOnly = roles({
      admin: { userCount: 0, permissions: [] },
      hr: { permissions: [...FLOOR] },
    });
    expect(lockoutReason(hrOnly, 'hr', [])).toMatch(/lock everyone out/);
  });

  it('permits unrelated permissions to be revoked freely', () => {
    expect(lockoutReason(roles(), 'hr', ['leave.manage'])).toBeNull();
  });

  it('permits granting', () => {
    expect(lockoutReason(roles(), 'emp', ['leave.read.own', 'document.read.own'])).toBeNull();
  });
});

describe('applyGuardrails', () => {
  it('keeps a protected permission and reports it rather than erroring', () => {
    const result = applyGuardrails(roles(), 'admin', ['report.export']);
    expect(result.permissions).toEqual(['report.export', 'role.manage', 'settings.manage']);
    expect(result.blocked.sort()).toEqual(['role.manage', 'settings.manage']);
  });

  it('blocks each floor permission separately when both are dropped at once', () => {
    const result = applyGuardrails(roles(), 'admin', []);
    expect(result.blocked.sort()).toEqual(['role.manage', 'settings.manage']);
  });

  it('restores only the floor, whatever order the grants are stored in', () => {
    // The real catalog lists the floor last, which is what exposed an
    // ordering-dependent bug: every earlier permission was reported blocked.
    const catalogOrder = roles({
      admin: { permissions: ['employee.read', 'report.export', ...FLOOR] },
    });
    const result = applyGuardrails(catalogOrder, 'admin', []);
    expect(result.blocked.sort()).toEqual(['role.manage', 'settings.manage']);
    expect(result.permissions).toEqual(['role.manage', 'settings.manage']);
  });

  it('never restores a non-floor permission', () => {
    const result = applyGuardrails(roles(), 'admin', [...FLOOR]);
    expect(result.blocked).toEqual([]);
    expect(result.permissions).toEqual(['role.manage', 'settings.manage']);
  });

  it('allows the revoke once a second staffed role holds the floor', () => {
    const withBackup = roles({ hr: { permissions: ['leave.manage', ...FLOOR] } });
    const result = applyGuardrails(withBackup, 'admin', ['report.export']);
    expect(result.permissions).toEqual(['report.export']);
    expect(result.blocked).toEqual([]);
  });

  it('grants new permissions and returns a sorted set', () => {
    const result = applyGuardrails(roles(), 'emp', ['leave.read.own', 'document.read.own']);
    expect(result.permissions).toEqual(['document.read.own', 'leave.read.own']);
  });

  it('is a no-op when nothing changes', () => {
    const result = applyGuardrails(roles(), 'hr', ['leave.manage', 'report.view']);
    expect(result.permissions).toEqual(['leave.manage', 'report.view']);
    expect(result.blocked).toEqual([]);
  });
});

describe('editBlockedReason', () => {
  it('protects system roles from rename and delete', () => {
    expect(editBlockedReason({ code: 'ADMIN', isSystem: true })).toMatch(/System roles/);
  });

  it('leaves custom roles editable', () => {
    expect(editBlockedReason({ code: 'PAYROLL', isSystem: false })).toBeNull();
  });
});

describe('deleteBlockedReason', () => {
  const custom = { code: 'OPS', isSystem: false };

  it('allows deleting a custom role nobody holds', () => {
    expect(deleteBlockedReason(custom, 0)).toBeNull();
  });

  it('refuses a system role before it even counts holders', () => {
    expect(deleteBlockedReason({ code: 'ADMIN', isSystem: true }, 0)).toMatch(/System roles/);
  });

  it('refuses while anybody holds it, and says how many', () => {
    expect(deleteBlockedReason(custom, 3)).toMatch(/3 people still hold/);
  });

  it('reads naturally for a single holder', () => {
    expect(deleteBlockedReason(custom, 1)).toMatch(/1 person still holds/);
  });
});

describe('roleMoveLockoutReason', () => {
  it('blocks moving the only admin out of the role holding the floor', () => {
    expect(roleMoveLockoutReason(roles(), 'admin', 'emp')).toMatch(/lock everyone out/);
  });

  it('allows the move when a second person still holds the floor role', () => {
    expect(roleMoveLockoutReason(roles({ admin: { userCount: 2 } }), 'admin', 'emp')).toBeNull();
  });

  it('allows promoting somebody into the floor role', () => {
    expect(roleMoveLockoutReason(roles(), 'emp', 'admin')).toBeNull();
  });

  it('is a no-op when the role does not change', () => {
    expect(roleMoveLockoutReason(roles(), 'admin', 'admin')).toBeNull();
  });

  it('keyed on people, not on the ADMIN code — an unstaffed ADMIN is no safety net', () => {
    // HR is the only *staffed* holder of the floor; moving its lone remaining
    // member out locks everyone out even though an ADMIN role still exists.
    const hrHoldsFloor = roles({
      admin: { userCount: 0 },
      hr: { userCount: 1, permissions: [...FLOOR] },
    });
    expect(roleMoveLockoutReason(hrHoldsFloor, 'hr', 'emp')).toMatch(/lock everyone out/);
  });
});
