-- Full & final settlement.
--
-- A settlement is not a payroll run and does not become one. `PayrollRun` is
-- unique per organization per month, prorates by working days and computes
-- statutory deductions on gross. A settlement lands weeks after the last
-- working day and must not push anybody's monthly gross past the ESI
-- threshold, which is a cliff rather than a taper. It carries its own figures.

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementLineKind" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "SettlementLineSource" AS ENUM ('LEAVE_ENCASHMENT', 'NOTICE_RECOVERY', 'GRATUITY', 'MANUAL');

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "offboardingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "lastWorkingDate" DATE NOT NULL,
    "joinDate" DATE NOT NULL,
    "monthlyPay" DECIMAL(14,2) NOT NULL,
    "perDayRate" DECIMAL(14,2) NOT NULL,
    "totalEarnings" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "computedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paymentRef" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementLine" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "kind" "SettlementLineKind" NOT NULL,
    "source" "SettlementLineSource" NOT NULL,
    "label" TEXT NOT NULL,
    "basis" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "order" INTEGER NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_offboardingId_key" ON "Settlement"("offboardingId");

-- CreateIndex
CREATE INDEX "Settlement_organizationId_status_idx" ON "Settlement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Settlement_employeeId_idx" ON "Settlement"("employeeId");

-- CreateIndex
CREATE INDEX "Settlement_organizationId_lastWorkingDate_idx" ON "Settlement"("organizationId", "lastWorkingDate");

-- CreateIndex
CREATE INDEX "SettlementLine_settlementId_order_idx" ON "SettlementLine"("settlementId", "order");

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_offboardingId_fkey" FOREIGN KEY ("offboardingId") REFERENCES "Offboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementLine" ADD CONSTRAINT "SettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The three components an exit actually pays, for every organization that
-- already exists. `bootstrap.ts` covers new ones; without this, an existing
-- deployment's component catalogue would be missing them forever, since
-- bootstrap only ever runs once per organization.
--
-- Same shape as the FINANCE role insert in 20260802090000_payroll_module:
-- cross-join Organization, ON CONFLICT DO NOTHING, deterministic ids so
-- re-running is a no-op rather than a duplicate.
--
-- Nothing computes these yet — settlements carry their own figures rather than
-- pushing lines into a payroll run. They exist so a settlement line has a real
-- component to map onto if that ever changes.
--
-- `order` is appended past whatever the organization already has, so these sort
-- to the end of a catalogue somebody may have reordered by hand. The subquery
-- reads the table as it stood when the statement began, so all three share one
-- base and keep their relative rank.
INSERT INTO "PayComponent" ("id", "organizationId", "code", "name", "kind", "taxable", "isStatutory", "isSystem", "order", "active")
SELECT
  'pc_' || c."code" || '_' || o."id",
  o."id",
  c."code",
  c."name",
  c."kind"::"PayComponentKind",
  c."taxable",
  false,
  true,
  COALESCE((SELECT MAX("order") FROM "PayComponent" p WHERE p."organizationId" = o."id"), 0) + c."rank",
  true
FROM "Organization" o
CROSS JOIN (VALUES
  -- Taxable as salary in the leaver's hands.
  ('LEAVE_ENCASHMENT', 'Leave Encashment', 'EARNING', true, 1),
  -- Exempt under section 10(10) up to the statutory ceiling, which is the
  -- ceiling the settlement settings default to.
  ('GRATUITY', 'Gratuity', 'EARNING', false, 2),
  ('NOTICE_RECOVERY', 'Notice Period Recovery', 'DEDUCTION', false, 3)
) AS c("code", "name", "kind", "taxable", "rank")
ON CONFLICT ("organizationId", "code") DO NOTHING;
