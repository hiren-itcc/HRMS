-- Indexes for filters that already existed on screen but not in the schema.
--
-- Measured rather than guessed. `EXPLAIN` on the tenant-scoped shapes the app
-- actually issues showed most of them already served by the composite
-- `(organizationId, X)` indexes — which is the right shape for a multi-tenant
-- read and better than a single-column index on the foreign key would be.
--
-- These four were the real gaps:
--
--   * The employee list filters on department, designation, location,
--     employment type and status. Only department and status had an index. The
--     other three seq-scanned, and `locationId` carries the directory's filter
--     too.
--   * EmergencyContact is read on every profile view, always by employeeId,
--     and had nothing but its primary key.
--
-- Deliberately NOT added: a single-column index on every foreign key. Twenty-
-- eight of them have no *leading* index, but nearly all are already covered
-- for real queries by the composite indexes above, and the rest are only
-- touched by referential-integrity checks on parent deletes — a cost that is
-- real but is paid on mass deletes, not on any screen. Twenty-eight indexes of
-- write overhead for a benefit nothing can currently observe is a bad trade.
CREATE INDEX "EmergencyContact_employeeId_idx" ON "EmergencyContact"("employeeId");
CREATE INDEX "Employee_organizationId_locationId_idx" ON "Employee"("organizationId", "locationId");
CREATE INDEX "Employee_organizationId_designationId_idx" ON "Employee"("organizationId", "designationId");
CREATE INDEX "Employee_organizationId_employmentTypeId_idx" ON "Employee"("organizationId", "employmentTypeId");
