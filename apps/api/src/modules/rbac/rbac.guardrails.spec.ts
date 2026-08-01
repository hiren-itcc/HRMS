import {
  applyGuardrails,
  canRevoke,
  editBlockedReason,
  revokeBlockedReason,
} from './rbac.guardrails';

const ADMIN = { code: 'ADMIN', isSystem: true };
const HR = { code: 'HR', isSystem: true };
const CUSTOM = { code: 'PAYROLL', isSystem: false };

describe('revoke guardrails', () => {
  it('stops Admin losing the permissions that would lock everyone out', () => {
    expect(canRevoke(ADMIN, 'settings.manage')).toBe(false);
    expect(canRevoke(ADMIN, 'role.manage')).toBe(false);
  });

  it('explains why, so the API and the tooltip agree', () => {
    expect(revokeBlockedReason(ADMIN, 'role.manage')).toMatch(/lock everyone out/);
  });

  it('allows Admin to lose anything outside the floor', () => {
    expect(canRevoke(ADMIN, 'report.export')).toBe(true);
    expect(canRevoke(ADMIN, 'audit.read')).toBe(true);
  });

  it('does not protect the same permissions on other roles', () => {
    expect(canRevoke(HR, 'settings.manage')).toBe(true);
    expect(canRevoke(CUSTOM, 'role.manage')).toBe(true);
  });
});

describe('editBlockedReason', () => {
  it('protects system roles from rename and delete', () => {
    expect(editBlockedReason(ADMIN)).toMatch(/System roles/);
  });

  it('leaves custom roles editable', () => {
    expect(editBlockedReason(CUSTOM)).toBeNull();
  });
});

describe('applyGuardrails', () => {
  it('adds protected permissions back rather than rejecting the whole edit', () => {
    const result = applyGuardrails(
      ADMIN,
      ['settings.manage', 'role.manage', 'report.export'],
      ['report.export'],
    );
    expect(result.permissions).toEqual(['report.export', 'role.manage', 'settings.manage']);
    expect(result.blocked).toEqual(['settings.manage', 'role.manage']);
  });

  it('reports nothing blocked on an allowed edit', () => {
    const result = applyGuardrails(HR, ['leave.manage', 'report.view'], ['leave.manage']);
    expect(result.permissions).toEqual(['leave.manage']);
    expect(result.blocked).toEqual([]);
  });

  it('grants new permissions and keeps the result sorted', () => {
    const result = applyGuardrails(CUSTOM, ['leave.read'], ['leave.read', 'employee.read']);
    expect(result.permissions).toEqual(['employee.read', 'leave.read']);
  });

  it('is a no-op when nothing changes', () => {
    const result = applyGuardrails(HR, ['org.manage'], ['org.manage']);
    expect(result.permissions).toEqual(['org.manage']);
    expect(result.blocked).toEqual([]);
  });
});
