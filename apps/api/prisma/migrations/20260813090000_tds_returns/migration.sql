-- TDS: the challan register, and Form 24Q frozen once generated.
--
-- Two tables, one enum, and — checked by eye against `prisma migrate diff`
-- before this shipped — zero DROP, zero ALTER COLUMN, and no ALTER TABLE
-- against any table that already existed. The two ALTER TABLEs below are
-- ADD CONSTRAINT on the two new ones. Organization gains Prisma relation
-- arrays, which emit no DDL at all.
--
-- No Permission or RolePermission rows. Unlike every other module migration
-- here, this one seeds none, because it introduces no permission code: the
-- register and the return are both gated by `payroll.filing`, which already
-- exists and which permissions.ts already grants to HR and Finance. There is
-- therefore no sidebar-invisible failure of the kind 20260807070000_expenses
-- shipped with.
--
-- StatutoryFiling is deliberately not reused. Its period is `YYYY-MM`
-- "matching PayrollRun.month" and its runId is NOT NULL, while a 24Q is
-- quarterly and spans three runs; fitting it here would mean making runId
-- nullable for ECR and ESIC too. See ADR-001.

-- CreateEnum
CREATE TYPE "TdsQuarter" AS ENUM ('Q1', 'Q2', 'Q3', 'Q4');

-- CreateTable
CREATE TABLE "TdsChallan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "bsrCode" TEXT NOT NULL,
    "challanSerial" TEXT NOT NULL,
    "depositDate" TIMESTAMP(3) NOT NULL,
    "sectionCode" TEXT NOT NULL DEFAULT '92B',
    "minorHead" TEXT NOT NULL DEFAULT '200',
    "tds" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "educationCess" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "penalty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "others" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "TdsChallan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdsReturn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "quarter" "TdsQuarter" NOT NULL,
    "content" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,

    CONSTRAINT "TdsReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TdsChallan_organizationId_period_idx" ON "TdsChallan"("organizationId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "TdsChallan_organizationId_period_key" ON "TdsChallan"("organizationId", "period");

-- CreateIndex
CREATE INDEX "TdsReturn_organizationId_financialYear_idx" ON "TdsReturn"("organizationId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "TdsReturn_organizationId_financialYear_quarter_key" ON "TdsReturn"("organizationId", "financialYear", "quarter");

-- AddForeignKey
ALTER TABLE "TdsChallan" ADD CONSTRAINT "TdsChallan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsReturn" ADD CONSTRAINT "TdsReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
