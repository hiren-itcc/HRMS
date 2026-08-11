-- CreateEnum
CREATE TYPE "StatutoryFilingKind" AS ENUM ('ECR', 'ESIC_RETURN');

-- CreateTable
CREATE TABLE "StatutoryFiling" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "StatutoryFilingKind" NOT NULL,
    "period" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,

    CONSTRAINT "StatutoryFiling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatutoryFiling_organizationId_period_idx" ON "StatutoryFiling"("organizationId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "StatutoryFiling_organizationId_kind_period_key" ON "StatutoryFiling"("organizationId", "kind", "period");

-- AddForeignKey
ALTER TABLE "StatutoryFiling" ADD CONSTRAINT "StatutoryFiling_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────
-- One table, one enum, no existing table touched.
--
-- `payroll.filing` is granted to Admin, HR and Finance for every organization
-- that already exists — docs/04-rbac.md requires the grant here rather than
-- leaving it to a re-seed, which is what the expenses migration got wrong.
--
-- It sits apart from `payroll.read` because reading numbers and putting an
-- establishment code on a file with legal consequences are different
-- privileges, and apart from `payroll.process` because a return is produced
-- after a run is published rather than as part of processing it.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "Permission" ("id", "code", "resource", "action")
VALUES ('perm_payroll_filing', 'payroll.filing', 'payroll', 'filing')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'payroll.filing'
WHERE r."code" IN ('ADMIN', 'HR', 'FINANCE')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
