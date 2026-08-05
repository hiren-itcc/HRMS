-- ─────────────────────────────────────────────────────────────────────
-- The exit clearance checklist.
--
-- Purely additive: one table, two enums, no change to any existing column.
-- Safe to apply while the previous version is still serving — nothing reads
-- it yet, and an offboarding with no tasks behaves exactly as it does today.
-- ─────────────────────────────────────────────────────────────────────

CREATE TYPE "ClearanceOwner" AS ENUM ('MANAGER', 'HR', 'FINANCE', 'IT_ADMIN');

CREATE TYPE "OffboardingTaskStatus" AS ENUM ('PENDING', 'DONE', 'NOT_APPLICABLE');

CREATE TABLE "OffboardingTask" (
  "id"            TEXT NOT NULL,
  "offboardingId" TEXT NOT NULL,
  "label"         TEXT NOT NULL,
  "description"   TEXT,
  "owner"         "ClearanceOwner" NOT NULL,
  "required"      BOOLEAN NOT NULL DEFAULT true,
  "order"         INTEGER NOT NULL,
  "status"        "OffboardingTaskStatus" NOT NULL DEFAULT 'PENDING',
  "note"          TEXT,
  "doneAt"        TIMESTAMP(3),
  "doneById"      TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OffboardingTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OffboardingTask_offboardingId_order_idx" ON "OffboardingTask"("offboardingId", "order");
CREATE INDEX "OffboardingTask_offboardingId_status_idx" ON "OffboardingTask"("offboardingId", "status");

-- Cascade: the tasks are part of the offboarding, not a record of their own.
-- Nothing else points at them and they mean nothing without it.
ALTER TABLE "OffboardingTask" ADD CONSTRAINT "OffboardingTask_offboardingId_fkey"
  FOREIGN KEY ("offboardingId") REFERENCES "Offboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
