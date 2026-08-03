-- Letters module: generated employment letters (offer, appointment,
-- experience, salary certificate) and per-org template overrides.

-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('ISSUED', 'VOID');

-- CreateTable
CREATE TABLE "LetterTemplate" (
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterTemplate_pkey" PRIMARY KEY ("organizationId","key")
);

-- CreateTable
CREATE TABLE "Letter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "letterNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "departmentName" TEXT,
    "designationName" TEXT,
    "joinDate" DATE NOT NULL,
    "exitDate" DATE,
    "monthlyCtc" DECIMAL(14,2),
    "containsSalary" BOOLEAN NOT NULL DEFAULT false,
    "variables" JSONB NOT NULL,
    "status" "LetterStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Letter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Letter_organizationId_letterNumber_key" ON "Letter"("organizationId", "letterNumber");

-- CreateIndex
CREATE INDEX "Letter_employeeId_issuedAt_idx" ON "Letter"("employeeId", "issuedAt");

-- CreateIndex
CREATE INDEX "Letter_organizationId_templateKey_issuedAt_idx" ON "Letter"("organizationId", "templateKey", "issuedAt");

-- AddForeignKey
ALTER TABLE "LetterTemplate" ADD CONSTRAINT "LetterTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Permission seeds (docs/04-rbac.md §adding a future module).
-- Grants go to EVERY existing organization: a tenant that upgrades must not
-- end up with fewer capabilities than a freshly seeded one.
--
-- No new system role, so unlike the payroll migration there is no Role
-- insert — the four codes attach to the roles that already exist.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "Permission" ("id", "code", "resource", "action")
SELECT
  'perm_' || replace(code, '.', '_'),
  code,
  split_part(code, '.', 1),
  substring(code from position('.' in code) + 1)
FROM (VALUES
  ('letter.read.own'),
  ('letter.read'),
  ('letter.issue'),
  ('letter.template.manage')
) AS p(code)
ON CONFLICT ("code") DO NOTHING;

-- Grants as (role code, permission code) pairs, so this reads the same way
-- ROLE_PERMISSIONS does in packages/shared.
--
-- Every role gets `letter.read.own` — an employee must be able to read the
-- letter they were handed. Nobody gets a `.team` scope: a letter is a
-- bilateral instrument, not a filing cabinet a manager browses.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  ('ADMIN',    'letter.read.own'),
  ('ADMIN',    'letter.read'),
  ('ADMIN',    'letter.issue'),
  ('ADMIN',    'letter.template.manage'),
  ('HR',       'letter.read.own'),
  ('HR',       'letter.read'),
  ('HR',       'letter.issue'),
  ('HR',       'letter.template.manage'),
  ('FINANCE',  'letter.read.own'),
  ('MANAGER',  'letter.read.own'),
  ('EMPLOYEE', 'letter.read.own')
) AS g(role_code, perm_code) ON g.role_code = r."code"
JOIN "Permission" p ON p."code" = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
