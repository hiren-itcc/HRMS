-- Leave that is paid out on exit rather than forfeited.
--
-- Defaults to false, and the backfill is deliberately the same: most leave
-- types are use-it-or-lose-it, and switching every existing type on would
-- silently add a payout to every settlement computed afterwards. HR turns it
-- on for the types their policy actually encashes.
ALTER TABLE "LeaveType" ADD COLUMN "encashable" BOOLEAN NOT NULL DEFAULT false;
