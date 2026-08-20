-- Restores Department.headId, dropped one migration ago by
-- 20260820104500_cleanup_dead_schema on a false premise. The audit doc called
-- it "a seed-only column nothing queries"; the department report
-- (reports.service.ts, the `head` select and the per-row head name) reads it.
-- Verified the honest way this time: the drop failed the typecheck.
-- The seed repopulates the three department heads.

-- AlterTable
ALTER TABLE "Department" ADD COLUMN "headId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Department_headId_key" ON "Department"("headId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_headId_fkey" FOREIGN KEY ("headId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
