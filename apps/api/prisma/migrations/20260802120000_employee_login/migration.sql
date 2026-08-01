-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;


-- ─────────────────────────────────────────────────────────────────────
-- Repair employee codes that were stored blank.
--
-- The create schema mapped an untouched form field to "" rather than to
-- absent, so the auto-generated code was skipped and "" was written. Only
-- the first such row per organization survived — the unique index rejected
-- the rest — so this backfills whatever did get through.
--
-- Numbering continues from the highest existing EMP-#### so a repaired row
-- can never collide with one that was fine.
-- ─────────────────────────────────────────────────────────────────────

WITH numbered AS (
  SELECT
    e."id",
    e."organizationId",
    ROW_NUMBER() OVER (PARTITION BY e."organizationId" ORDER BY e."createdAt") AS seq,
    COALESCE(
      (
        SELECT MAX(CAST(SUBSTRING(x."employeeCode" FROM 'EMP-([0-9]+)$') AS INTEGER))
        FROM "Employee" x
        WHERE x."organizationId" = e."organizationId"
          AND x."employeeCode" ~ '^EMP-[0-9]+$'
      ),
      0
    ) AS highest
  FROM "Employee" e
  WHERE e."employeeCode" IS NULL OR btrim(e."employeeCode") = ''
)
UPDATE "Employee" e
SET "employeeCode" = 'EMP-' || LPAD((n.highest + n.seq)::text, 4, '0')
FROM numbered n
WHERE e."id" = n."id";
