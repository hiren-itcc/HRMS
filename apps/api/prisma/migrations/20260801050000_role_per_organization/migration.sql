-- Roles were global: one set of four rows shared by every organization, so
-- editing HR's grants in one tenant would have changed them in all of them.
-- Backfill in three steps so no existing user loses their role.

-- 1. Add the column nullable.
ALTER TABLE "Role" ADD COLUMN "organizationId" TEXT;

-- 2. Claim each role for the organization whose users actually hold it.
UPDATE "Role" r
SET "organizationId" = (
  SELECT u."organizationId" FROM "User" u WHERE u."roleId" = r."id" LIMIT 1
);

-- 3. Roles nobody holds yet (a freshly seeded catalog) go to the oldest org.
UPDATE "Role"
SET "organizationId" = (SELECT "id" FROM "Organization" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "organizationId" IS NULL;

ALTER TABLE "Role" ALTER COLUMN "organizationId" SET NOT NULL;

-- Swap the global unique code for a per-tenant one.
DROP INDEX "Role_code_key";
CREATE UNIQUE INDEX "Role_organizationId_code_key" ON "Role"("organizationId", "code");
CREATE INDEX "Role_organizationId_idx" ON "Role"("organizationId");

ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- "Which users hold this role" was a sequential scan.
CREATE INDEX "User_roleId_idx" ON "User"("roleId");
