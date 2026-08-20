-- Remove the statutory returns feature: EPFO/ESIC filings, the TDS challan
-- register, and Form 24Q. The product's scope decision of 2026-08-20 — the
-- monthly TDS calculation (the eight Tax* tables from 20260813110000_income_tax)
-- stays; the filing of returns to government portals does not.
--
-- The rows destroyed here are frozen generated files and the seeded demo
-- challan register. Nothing else references these tables: no foreign key
-- points at them, and their only writers (statutory-filings.service.ts,
-- tds-challans.service.ts, tds-returns.service.ts) are deleted in the same
-- change.

-- DropTable
DROP TABLE "StatutoryFiling";

-- DropTable
DROP TABLE "TdsChallan";

-- DropTable
DROP TABLE "TdsReturn";

-- DropEnum
DROP TYPE "StatutoryFilingKind";

-- DropEnum
DROP TYPE "TdsQuarter";
