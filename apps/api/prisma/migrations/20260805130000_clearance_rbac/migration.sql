-- ─────────────────────────────────────────────────────────────────────
-- `offboarding.clearance` — signing off one line of somebody's exit.
--
-- No tables change. Same shape as 20260805090000_lifecycle_rbac: the grant has
-- to reach every organization that already exists, not only ones bootstrapped
-- from here on, or the feature ships dark in every current tenant.
--
-- Deliberately not folded into `employee.offboard`. That one decides whether
-- and when somebody leaves; this one says a laptop came back. Finance and
-- Managers hold this and nothing else about exits — which is the point.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "Permission" ("id", "code", "resource", "action")
VALUES (
  'perm_offboarding_clearance',
  'offboarding.clearance',
  'offboarding',
  'clearance'
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  ('ADMIN'),
  ('HR'),
  -- Finance clears outstanding dues and advances on the way out.
  ('FINANCE'),
  -- A manager signs off the handover for their own leaver. Whose leaver is a
  -- question the guard cannot answer, so the service checks it.
  ('MANAGER')
) AS g(role_code) ON g.role_code = r."code"
JOIN "Permission" p ON p."code" = 'offboarding.clearance'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
