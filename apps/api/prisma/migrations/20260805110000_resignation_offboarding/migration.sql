-- ─────────────────────────────────────────────────────────────────────
-- Resignation and offboarding.
--
-- Purely additive: two tables, four enums, no change to Employee. Safe to
-- apply while the previous version is still serving.
-- ─────────────────────────────────────────────────────────────────────

CREATE TYPE "ResignationStatus" AS ENUM (
  'SUBMITTED', 'MANAGER_APPROVED', 'CHANGES_REQUESTED',
  'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED'
);

CREATE TYPE "ResignationReason" AS ENUM (
  'BETTER_OPPORTUNITY', 'COMPENSATION', 'RELOCATION', 'HIGHER_STUDIES',
  'HEALTH', 'PERSONAL', 'WORK_ENVIRONMENT', 'CAREER_CHANGE', 'OTHER'
);

CREATE TYPE "OffboardingReason" AS ENUM (
  'RESIGNATION', 'TERMINATION', 'CONTRACT_END', 'RETIREMENT', 'ABSCONDING', 'OTHER'
);

CREATE TYPE "OffboardingStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "Resignation" (
  "id"                       TEXT NOT NULL,
  "organizationId"           TEXT NOT NULL,
  "employeeId"               TEXT NOT NULL,
  "status"                   "ResignationStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reason"                   "ResignationReason" NOT NULL,
  "remarks"                  TEXT,
  "requestedLastWorkingDate" DATE NOT NULL,
  "approvedLastWorkingDate"  DATE,
  "noticeDays"               INTEGER NOT NULL,
  "earliestLastWorkingDate"  DATE NOT NULL,
  "submittedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "routedManagerId"          TEXT,
  "managerDecidedAt"         TIMESTAMP(3),
  "managerDecidedById"       TEXT,
  "managerRemarks"           TEXT,
  "hrDecidedAt"              TIMESTAMP(3),
  "hrDecidedById"            TEXT,
  "hrRemarks"                TEXT,
  "withdrawnAt"              TIMESTAMP(3),
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Resignation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Offboarding" (
  "id"                  TEXT NOT NULL,
  "organizationId"      TEXT NOT NULL,
  "employeeId"          TEXT NOT NULL,
  "resignationId"       TEXT,
  "reason"              "OffboardingReason" NOT NULL,
  "reasonNote"          TEXT,
  "lastWorkingDate"     DATE NOT NULL,
  "status"              "OffboardingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "snapshotDepartment"  TEXT,
  "snapshotDesignation" TEXT,
  "snapshotManagerName" TEXT,
  "snapshotJoinDate"    DATE NOT NULL,
  "startedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedById"         TEXT,
  "completedAt"         TIMESTAMP(3),
  "completedById"       TEXT,
  "cancelledAt"         TIMESTAMP(3),
  "cancelReason"        TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Offboarding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Offboarding_resignationId_key" ON "Offboarding"("resignationId");

CREATE INDEX "Resignation_organizationId_status_idx" ON "Resignation"("organizationId", "status");
CREATE INDEX "Resignation_employeeId_idx" ON "Resignation"("employeeId");
CREATE INDEX "Resignation_routedManagerId_status_idx" ON "Resignation"("routedManagerId", "status");

CREATE INDEX "Offboarding_organizationId_status_idx" ON "Offboarding"("organizationId", "status");
CREATE INDEX "Offboarding_employeeId_idx" ON "Offboarding"("employeeId");
CREATE INDEX "Offboarding_organizationId_lastWorkingDate_idx" ON "Offboarding"("organizationId", "lastWorkingDate");

ALTER TABLE "Resignation" ADD CONSTRAINT "Resignation_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Offboarding" ADD CONSTRAINT "Offboarding_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Offboarding" ADD CONSTRAINT "Offboarding_resignationId_fkey"
  FOREIGN KEY ("resignationId") REFERENCES "Resignation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- One open request per employee, enforced by the database.
--
-- The services check first so the user reads a sentence rather than a
-- constraint violation, but a check followed by an insert loses a race with a
-- double-clicked submit button. Prisma cannot express a partial unique index,
-- so these are written by hand — which is the reason this migration is not
-- generated.
--
-- COMPLETED, REJECTED and WITHDRAWN are excluded: somebody who resigned,
-- withdrew, and later resigned again has two rows and both are real. So does
-- somebody re-hired after leaving.
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "Resignation_one_open_per_employee"
  ON "Resignation"("employeeId")
  WHERE "status" IN ('SUBMITTED', 'MANAGER_APPROVED', 'CHANGES_REQUESTED', 'APPROVED');

CREATE UNIQUE INDEX "Offboarding_one_open_per_employee"
  ON "Offboarding"("employeeId")
  WHERE "status" = 'IN_PROGRESS';
