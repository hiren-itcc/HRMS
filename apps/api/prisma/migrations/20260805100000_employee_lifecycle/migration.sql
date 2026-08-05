-- ─────────────────────────────────────────────────────────────────────
-- Probation and notice period on Employee.
--
-- All five columns are nullable, so this is safe to apply while the previous
-- version is still serving: nothing reads them yet.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE "Employee"
  ADD COLUMN "noticePeriodDays"    INTEGER,
  ADD COLUMN "probationMonths"     INTEGER,
  ADD COLUMN "probationEndDate"    DATE,
  ADD COLUMN "probationExtendedTo" DATE,
  ADD COLUMN "confirmedOn"         DATE;

-- ─────────────────────────────────────────────────────────────────────
-- Backfill, and it is the important line in this file.
--
-- Probation is derived from `probationEndDate` and `confirmedOn`. Left alone,
-- every existing employee would have both null — which the rules read as
-- "never on probation", not "confirmed". That is nearly right, but it means an
-- employee of three years shows no confirmation date at all, and HR has no way
-- to tell them apart from a consultant who was never on probation.
--
-- Stamping `confirmedOn = joinDate` says the true thing: everybody already on
-- the books before this feature existed is confirmed staff, and has been since
-- the day they joined. Probation starts applying to people hired from here on.
--
-- Leavers included. Somebody who left in 2025 was still confirmed staff while
-- they were here, and a null would make their record read as if they never
-- were.
--
-- ONBOARDING is excluded because those people have not started. Approving
-- their onboarding is what puts them on probation, the same as a new hire.
-- ─────────────────────────────────────────────────────────────────────

UPDATE "Employee"
SET "confirmedOn" = "joinDate"
WHERE "status" <> 'ONBOARDING';

CREATE INDEX "Employee_organizationId_probationEndDate_idx"
  ON "Employee"("organizationId", "probationEndDate");

CREATE INDEX "Employee_organizationId_exitDate_idx"
  ON "Employee"("organizationId", "exitDate");
