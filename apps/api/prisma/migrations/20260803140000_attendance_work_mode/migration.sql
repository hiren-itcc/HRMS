-- Clocking in now records where someone says they are working, and — where
-- that claim is checkable — where they actually were. The claim and the
-- evidence are stored separately and side by side, because a position fix is
-- evidence rather than proof: browser geolocation is often kilometres out, so
-- the verdict below distinguishes "outside the office" from "we could not
-- tell", and only one of those is an accusation.
CREATE TYPE "WorkMode" AS ENUM ('OFFICE', 'REMOTE', 'CLIENT_SITE');
CREATE TYPE "LocationVerification" AS ENUM ('VERIFIED', 'OUTSIDE', 'UNVERIFIED', 'NOT_APPLICABLE');

-- The geofence an OFFICE claim is measured against. Coordinates stay optional:
-- an office nobody has placed on the map simply verifies nobody.
ALTER TABLE "Location" ADD COLUMN     "latitude" DOUBLE PRECISION;
ALTER TABLE "Location" ADD COLUMN     "longitude" DOUBLE PRECISION;
ALTER TABLE "Location" ADD COLUMN     "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 200;

-- The claim, plus a fix at each end of the session.
ALTER TABLE "AttendanceSession" ADD COLUMN     "workMode" "WorkMode" NOT NULL DEFAULT 'OFFICE';
ALTER TABLE "AttendanceSession" ADD COLUMN     "locationId" TEXT;
ALTER TABLE "AttendanceSession" ADD COLUMN     "inLatitude" DOUBLE PRECISION;
ALTER TABLE "AttendanceSession" ADD COLUMN     "inLongitude" DOUBLE PRECISION;
ALTER TABLE "AttendanceSession" ADD COLUMN     "inAccuracyMeters" INTEGER;
ALTER TABLE "AttendanceSession" ADD COLUMN     "inVerification" "LocationVerification" NOT NULL DEFAULT 'NOT_APPLICABLE';
ALTER TABLE "AttendanceSession" ADD COLUMN     "inDistanceMeters" INTEGER;
ALTER TABLE "AttendanceSession" ADD COLUMN     "outLatitude" DOUBLE PRECISION;
ALTER TABLE "AttendanceSession" ADD COLUMN     "outLongitude" DOUBLE PRECISION;
ALTER TABLE "AttendanceSession" ADD COLUMN     "outAccuracyMeters" INTEGER;
ALTER TABLE "AttendanceSession" ADD COLUMN     "outVerification" "LocationVerification" NOT NULL DEFAULT 'NOT_APPLICABLE';
ALTER TABLE "AttendanceSession" ADD COLUMN     "outDistanceMeters" INTEGER;

ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The day's mode, rolled up from its sessions so the reports that already read
-- this row never have to join them.
ALTER TABLE "AttendanceRecord" ADD COLUMN     "workMode" "WorkMode";

-- Backfill. Every session that already exists was worked before there was any
-- choice to make, so OFFICE is what the column default records for them — and
-- their verification stays NOT_APPLICABLE, because nothing was ever measured.
-- The day rollup follows from that: a day with sessions was an office day.
UPDATE "AttendanceRecord" r
SET "workMode" = 'OFFICE'
WHERE EXISTS (SELECT 1 FROM "AttendanceSession" s WHERE s."recordId" = r."id");
