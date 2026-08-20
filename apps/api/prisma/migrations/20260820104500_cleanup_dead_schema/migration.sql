-- Dead-schema sweep (2026-08-20): things declared and never produced.
--
-- AttendanceSource loses MOBILE and IMPORT, LocationVerification loses
-- OUTSIDE — no write path or seed ever assigned any of the three, verified
-- by grep before this was generated. Department.headId was written by the
-- seed and read by nothing; no DTO accepted it. Document.visibility and
-- DocVisibility go whole: zero reads, writes or filters anywhere — the
-- org-wide documents feature it anticipated never grew code.
--
-- NOT_APPLICABLE stays on LocationVerification: it is the column default
-- on AttendanceSession, visible in the SET DEFAULT lines below.

-- AlterEnum
BEGIN;
CREATE TYPE "AttendanceSource_new" AS ENUM ('WEB', 'ADMIN');
ALTER TABLE "public"."AttendanceRecord" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "public"."AttendanceSession" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "AttendanceRecord" ALTER COLUMN "source" TYPE "AttendanceSource_new" USING ("source"::text::"AttendanceSource_new");
ALTER TABLE "AttendanceSession" ALTER COLUMN "source" TYPE "AttendanceSource_new" USING ("source"::text::"AttendanceSource_new");
ALTER TYPE "AttendanceSource" RENAME TO "AttendanceSource_old";
ALTER TYPE "AttendanceSource_new" RENAME TO "AttendanceSource";
DROP TYPE "public"."AttendanceSource_old";
ALTER TABLE "AttendanceRecord" ALTER COLUMN "source" SET DEFAULT 'WEB';
ALTER TABLE "AttendanceSession" ALTER COLUMN "source" SET DEFAULT 'WEB';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "LocationVerification_new" AS ENUM ('VERIFIED', 'UNVERIFIED', 'NOT_APPLICABLE');
ALTER TABLE "public"."AttendanceSession" ALTER COLUMN "inVerification" DROP DEFAULT;
ALTER TABLE "public"."AttendanceSession" ALTER COLUMN "outVerification" DROP DEFAULT;
ALTER TABLE "AttendanceSession" ALTER COLUMN "inVerification" TYPE "LocationVerification_new" USING ("inVerification"::text::"LocationVerification_new");
ALTER TABLE "AttendanceSession" ALTER COLUMN "outVerification" TYPE "LocationVerification_new" USING ("outVerification"::text::"LocationVerification_new");
ALTER TYPE "LocationVerification" RENAME TO "LocationVerification_old";
ALTER TYPE "LocationVerification_new" RENAME TO "LocationVerification";
DROP TYPE "public"."LocationVerification_old";
ALTER TABLE "AttendanceSession" ALTER COLUMN "inVerification" SET DEFAULT 'NOT_APPLICABLE';
ALTER TABLE "AttendanceSession" ALTER COLUMN "outVerification" SET DEFAULT 'NOT_APPLICABLE';
COMMIT;

-- DropForeignKey
ALTER TABLE "Department" DROP CONSTRAINT "Department_headId_fkey";

-- DropIndex
DROP INDEX "Department_headId_key";

-- AlterTable
ALTER TABLE "Department" DROP COLUMN "headId";

-- AlterTable
ALTER TABLE "Document" DROP COLUMN "visibility";

-- DropEnum
DROP TYPE "DocVisibility";

