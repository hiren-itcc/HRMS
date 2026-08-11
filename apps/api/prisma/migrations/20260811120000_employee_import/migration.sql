-- CreateEnum
CREATE TYPE "EmployeeImportMode" AS ENUM ('RECORDS', 'INVITE');

-- CreateEnum
CREATE TYPE "EmployeeImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "EmployeeImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "mode" "EmployeeImportMode" NOT NULL DEFAULT 'RECORDS',
    "status" "EmployeeImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "rows" JSONB NOT NULL,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "invitedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeImport_organizationId_createdAt_idx" ON "EmployeeImport"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmployeeImport" ADD CONSTRAINT "EmployeeImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────
-- One table, two enums, and no change to any existing table.
--
-- Plus the permission, granted for every organization that already exists.
-- docs/04-rbac.md requires this of every new capability, and the expenses
-- migration skipping it is why an admin could not see that module until a
-- destructive re-seed. `employee.import` goes to Admin and HR only: it is the
-- code for loading a whole company at once, and Finance and Managers have no
-- use for it.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "Permission" ("id", "code", "resource", "action")
VALUES ('perm_employee_import', 'employee.import', 'employee', 'import')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'employee.import'
WHERE r."code" IN ('ADMIN', 'HR')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
