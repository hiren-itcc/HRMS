-- ─────────────────────────────────────────────────────────────────────
-- RBAC for the employment lifecycle: probation confirmation and
-- resignation.
--
-- No tables change here. Permissions are global rows and grants are per
-- (organization, role), so an organization that upgrades must come out with
-- the same capabilities a freshly bootstrapped one gets — otherwise nobody in
-- an existing tenant can approve a resignation, and the feature ships dark.
-- Same shape as 20260802090000_payroll_module.
--
-- Offboarding deliberately adds no code of its own. `employee.offboard`
-- already exists, is already granted to exactly ADMIN and HR, and already
-- means "may change whether this person works here".
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "Permission" ("id", "code", "resource", "action")
SELECT
  'perm_' || replace(code, '.', '_'),
  code,
  split_part(code, '.', 1),
  substring(code from position('.' in code) + 1)
FROM (VALUES
  ('employee.confirm'),
  ('resignation.request.own'),
  ('resignation.read.own'),
  ('resignation.read.team'),
  ('resignation.approve.team'),
  ('resignation.read'),
  ('resignation.approve')
) AS p(code)
ON CONFLICT ("code") DO NOTHING;

-- Grants, as (role code, permission code) pairs so this reads the same way
-- ROLE_PERMISSIONS does in packages/shared/src/constants/permissions.ts.
--
-- Every role gets the two `.own` codes, FINANCE included: resigning is not a
-- privilege HR grants, and a Finance user who cannot file one would simply
-- send an email instead.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  ('ADMIN',    'employee.confirm'),
  ('ADMIN',    'resignation.request.own'),
  ('ADMIN',    'resignation.read.own'),
  ('ADMIN',    'resignation.read.team'),
  ('ADMIN',    'resignation.approve.team'),
  ('ADMIN',    'resignation.read'),
  ('ADMIN',    'resignation.approve'),
  ('HR',       'employee.confirm'),
  ('HR',       'resignation.request.own'),
  ('HR',       'resignation.read.own'),
  ('HR',       'resignation.read.team'),
  ('HR',       'resignation.approve.team'),
  ('HR',       'resignation.read'),
  ('HR',       'resignation.approve'),
  ('MANAGER',  'resignation.request.own'),
  ('MANAGER',  'resignation.read.own'),
  ('MANAGER',  'resignation.read.team'),
  ('MANAGER',  'resignation.approve.team'),
  ('FINANCE',  'resignation.request.own'),
  ('FINANCE',  'resignation.read.own'),
  ('EMPLOYEE', 'resignation.request.own'),
  ('EMPLOYEE', 'resignation.read.own')
) AS g(role_code, perm_code) ON g.role_code = r."code"
JOIN "Permission" p ON p."code" = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
