-- A day is now a series of clock-in/clock-out sessions rather than one pair,
-- so leaving for lunch — or clocking out by accident — no longer ends the day.
-- AttendanceRecord keeps its columns and its one-row-per-day shape (payroll and
-- reports aggregate on it), but they now hold a rollup of the sessions below.
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3),
    "source" "AttendanceSource" NOT NULL DEFAULT 'WEB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttendanceSession_recordId_checkIn_idx" ON "AttendanceSession"("recordId", "checkIn");

ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "AttendanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing day becomes a single session, so the rollup already
-- agrees with the record on the first read after deploy. Rows with no check-in
-- (a day marked absent, say) get no session, which is the right rollup for them.
-- Prisma generates cuids client-side, so ids come from the database here; they
-- are opaque strings and nothing parses them.
INSERT INTO "AttendanceSession" ("id", "recordId", "checkIn", "checkOut", "source", "createdAt")
SELECT gen_random_uuid()::text, "id", "checkIn", "checkOut", "source", "createdAt"
FROM "AttendanceRecord"
WHERE "checkIn" IS NOT NULL;
