-- Roles were global: one set of four rows shared by every organization, so
-- editing HR's grants in one tenant would have changed them in all of them.
--
-- Splitting them is not a matter of stamping each role with one org: a shared
-- role may be held by users in several. Each (organization, role) pair that
-- actually exists becomes its own row, with its own grants, and its users are
-- repointed — otherwise a tenant would keep pointing at another tenant's role
-- and the isolation this migration exists to create would not hold.

-- 1. Nullable to start, and drop the global unique code up front: step 3
-- inserts copies that deliberately share a code with the original, so the old
-- index has to be gone before then.
ALTER TABLE "Role" ADD COLUMN "organizationId" TEXT;
DROP INDEX "Role_code_key";

-- 2. Each role keeps one owning organization, chosen deterministically.
UPDATE "Role" r
SET "organizationId" = (
  SELECT u."organizationId" FROM "User" u
  WHERE u."roleId" = r."id"
  ORDER BY u."id" ASC
  LIMIT 1
);

-- 3. Every other organization holding that role gets its own copy.
DO $$
DECLARE pair RECORD;
        copy_id TEXT;
BEGIN
  FOR pair IN
    SELECT DISTINCT u."organizationId" AS org_id, r."id" AS role_id
    FROM "User" u
    JOIN "Role" r ON r."id" = u."roleId"
    WHERE r."organizationId" IS NOT NULL
      AND u."organizationId" <> r."organizationId"
  LOOP
    copy_id := gen_random_uuid()::text;

    INSERT INTO "Role" ("id", "organizationId", "code", "name", "description", "isSystem")
    SELECT copy_id, pair.org_id, "code", "name", "description", "isSystem"
    FROM "Role" WHERE "id" = pair.role_id;

    INSERT INTO "RolePermission" ("roleId", "permissionId")
    SELECT copy_id, "permissionId" FROM "RolePermission" WHERE "roleId" = pair.role_id;

    UPDATE "User" SET "roleId" = copy_id
    WHERE "organizationId" = pair.org_id AND "roleId" = pair.role_id;
  END LOOP;
END $$;

-- 4. Roles nobody holds (a freshly seeded catalog) go to the oldest org.
UPDATE "Role"
SET "organizationId" = (SELECT "id" FROM "Organization" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "organizationId" IS NULL;

ALTER TABLE "Role" ALTER COLUMN "organizationId" SET NOT NULL;

-- Now that every row has an owner, the code is unique per tenant.
CREATE UNIQUE INDEX "Role_organizationId_code_key" ON "Role"("organizationId", "code");
CREATE INDEX "Role_organizationId_idx" ON "Role"("organizationId");

ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- "Which users hold this role" was a sequential scan.
CREATE INDEX "User_roleId_idx" ON "User"("roleId");
