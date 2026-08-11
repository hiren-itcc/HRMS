-- ─────────────────────────────────────────────────────────────────────
-- Statutory identifiers, and the first ALTER TABLE any of this work has
-- needed against an existing table.
--
-- Four nullable columns, default-unchanged, no backfill and no behaviour
-- touched — the same additive shape `Employee.remoteDaysPerWeek` and
-- `OffboardingTask.kind` took.
--
-- Nullable is the safety story, not laziness. Every existing employee gets
-- NULL, and an employee with no UAN is EXCLUDED from an ECR return with a
-- stated reason rather than emitted with a blank field. `bankTransfer()`
-- already wrote that rule down: a file with a hole in it is worse than a short
-- one, because the hole is discovered by the recipient rather than by us.
--
-- No unique constraints. A PAN or a UAN really is unique in the world, but a
-- half-filled column across an existing tenant would refuse the second NULL on
-- some engines and, more importantly, an import that duplicates one should
-- fail on a validation message rather than a constraint violation.
-- ─────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "esicIpNumber" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "pfMemberId" TEXT,
ADD COLUMN     "uan" TEXT;

