-- Asset management.
--
-- Per-item rather than stock counts, which is what makes "who has SN-4471"
-- answerable and what lets the exit clearance stop being an assertion.

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "ClearanceKind" AS ENUM ('MANUAL', 'ASSET_RETURN');

-- AlterTable
--
-- Defaults to MANUAL, and nothing is backfilled. Every exit already underway
-- was being signed by hand and stays that way. Turning a completion gate on
-- underneath an in-flight exit is the one change here that could strand
-- somebody, so it is opt-in per organization from the checklist template.
ALTER TABLE "OffboardingTask" ADD COLUMN "kind" "ClearanceKind" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT,
    "make" TEXT,
    "model" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "purchaseDate" DATE,
    "purchaseCost" DECIMAL(14,2),
    "warrantyEnd" DATE,
    "vendor" TEXT,
    "locationId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "issuedById" TEXT,
    "conditionOut" "AssetCondition" NOT NULL,
    "returnedOn" DATE,
    "returnedById" TEXT,
    "conditionIn" "AssetCondition",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetCategory_organizationId_idx" ON "AssetCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_organizationId_name_key" ON "AssetCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Asset_organizationId_status_idx" ON "Asset"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Asset_organizationId_categoryId_idx" ON "Asset"("organizationId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_organizationId_assetTag_key" ON "Asset"("organizationId", "assetTag");

-- CreateIndex
CREATE INDEX "AssetAssignment_assetId_issuedOn_idx" ON "AssetAssignment"("assetId", "issuedOn");

-- CreateIndex
CREATE INDEX "AssetAssignment_employeeId_returnedOn_idx" ON "AssetAssignment"("employeeId", "returnedOn");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- An asset is in at most one person's hands at a time.
--
-- Prisma cannot express a partial unique index, and this is the invariant the
-- whole module rests on: without it, two concurrent issues of the same laptop
-- both succeed and the register can never be trusted again. Same shape as the
-- one-open-resignation index in 20260805110000_resignation_offboarding.
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "AssetAssignment_one_open_per_asset"
  ON "AssetAssignment"("assetId")
  WHERE "returnedOn" IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- RBAC. `asset.assign` is separate from `asset.manage` because buying and
-- retiring equipment is an admin job and handing a laptop to a joiner is not.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "Permission" ("id", "code", "resource", "action")
SELECT
  'perm_' || replace(code, '.', '_'),
  code,
  split_part(code, '.', 1),
  substring(code from position('.' in code) + 1)
FROM (VALUES
  ('asset.read.own'),
  ('asset.read'),
  ('asset.manage'),
  ('asset.assign')
) AS p(code)
ON CONFLICT ("code") DO NOTHING;

-- Grants, as (role code, permission code) pairs so this reads the same way the
-- TypeScript catalogue does. Every role gets `read.own` — being told what you
-- are holding is not a privilege, and a leaver who cannot see their own list
-- cannot return it.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  ('ADMIN',    'asset.read.own'),
  ('ADMIN',    'asset.read'),
  ('ADMIN',    'asset.manage'),
  ('ADMIN',    'asset.assign'),
  ('HR',       'asset.read.own'),
  ('HR',       'asset.read'),
  ('HR',       'asset.manage'),
  ('HR',       'asset.assign'),
  ('FINANCE',  'asset.read.own'),
  ('MANAGER',  'asset.read.own'),
  ('EMPLOYEE', 'asset.read.own')
) AS g(role_code, perm_code) ON g.role_code = r."code"
JOIN "Permission" p ON p."code" = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
