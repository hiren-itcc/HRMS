-- Late arrival is stored as a fact at check-in time (and recomputed when a
-- correction is approved), so history stays true if the shift is reassigned.
ALTER TABLE "AttendanceRecord" ADD COLUMN     "isLate" BOOLEAN NOT NULL DEFAULT false;
