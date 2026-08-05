-- Work from home.
--
-- Attendance already detects who worked remotely, from the position taken at
-- the punch. This is the other half: who was allowed to. Nothing here is
-- enforced at clock-in, so no attendance table is touched and no write path
-- changes -- an unapproved remote day is recorded as it always was and flagged
-- when somebody reads it.

-- AlterTable
--
-- Null means the company default, exactly as noticePeriodDays and
-- probationMonths already do. Nothing is backfilled: everybody starts on the
-- organization's cap, which is what they were on before this existed.
ALTER TABLE "Employee" ADD COLUMN "remoteDaysPerWeek" INTEGER;

-- CreateTable
CREATE TABLE "RemoteWorkRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" DECIMAL(4,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "actedAt" TIMESTAMP(3),
    "approverNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteWorkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemoteWorkRequest_employeeId_status_idx" ON "RemoteWorkRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "RemoteWorkRequest_organizationId_status_startDate_idx" ON "RemoteWorkRequest"("organizationId", "status", "startDate");

-- CreateIndex
CREATE INDEX "RemoteWorkRequest_organizationId_startDate_endDate_idx" ON "RemoteWorkRequest"("organizationId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "RemoteWorkRequest" ADD CONSTRAINT "RemoteWorkRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- RBAC. Mirrors leave rather than assets: the .team pair is the whole
-- workflow here, because a manager agreeing their own reports' days is what
-- this module is for.
--
-- No wfh.manage -- the weekly cap is a settings edit and the per-employee
-- allowance is an employee edit, both already gated by a code that exists.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "Permission" ("id", "code", "resource", "action")
SELECT
  'perm_' || replace(code, '.', '_'),
  code,
  split_part(code, '.', 1),
  substring(code from position('.' in code) + 1)
FROM (VALUES
  ('wfh.read.own'),
  ('wfh.request.own'),
  ('wfh.read.team'),
  ('wfh.approve.team'),
  ('wfh.read'),
  ('wfh.approve')
) AS p(code)
ON CONFLICT ("code") DO NOTHING;

-- Grants as (role code, permission code) pairs, so this reads the same way the
-- TypeScript catalogue does. Every role can ask, because withholding that would
-- only mean the request arrives by chat instead.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  ('ADMIN',    'wfh.read.own'),
  ('ADMIN',    'wfh.request.own'),
  ('ADMIN',    'wfh.read.team'),
  ('ADMIN',    'wfh.approve.team'),
  ('ADMIN',    'wfh.read'),
  ('ADMIN',    'wfh.approve'),
  ('HR',       'wfh.read.own'),
  ('HR',       'wfh.request.own'),
  ('HR',       'wfh.read.team'),
  ('HR',       'wfh.approve.team'),
  ('HR',       'wfh.read'),
  ('HR',       'wfh.approve'),
  ('MANAGER',  'wfh.read.own'),
  ('MANAGER',  'wfh.request.own'),
  ('MANAGER',  'wfh.read.team'),
  ('MANAGER',  'wfh.approve.team'),
  ('FINANCE',  'wfh.read.own'),
  ('FINANCE',  'wfh.request.own'),
  ('EMPLOYEE', 'wfh.read.own'),
  ('EMPLOYEE', 'wfh.request.own')
) AS g(role_code, perm_code) ON g.role_code = r."code"
JOIN "Permission" p ON p."code" = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
