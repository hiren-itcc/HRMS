-- The leave year is derived from an org setting an admin can change. Deriving
-- it again at approve/cancel meant a policy change between raising and acting
-- on a request sent the balance write to a different year's row — silently
-- inflating `used` or provisioning a whole extra year of allocation.
ALTER TABLE "LeaveRequest" ADD COLUMN "leaveYear" INTEGER;

-- Existing rows were all booked under the calendar-year default.
UPDATE "LeaveRequest" SET "leaveYear" = EXTRACT(YEAR FROM "startDate")::int;

ALTER TABLE "LeaveRequest" ALTER COLUMN "leaveYear" SET NOT NULL;
