-- ─────────────────────────────────────────────────────────────────────
-- Performance — cycles, goals and reviews.
--
-- Three tables, three enums, and **no column added to any existing table**.
-- The eight ALTER TABLEs below are all foreign keys on the new tables; there
-- is no DROP and no ALTER COLUMN in this file. `Employee` and `Organization`
-- gain Prisma relation arrays, which emit no DDL. That makes good on the
-- prediction in docs/11-roadmap.md §20 — "touches existing schema: none" — and
-- it is the line to check by eye before deploying.
--
-- `ReviewStatus` is deliberately not `ApprovalStatus`. A review is never
-- approved and never rejected; it is written by two people, shared, and signed
-- off. Mapping SHARED onto APPROVED would make that enum's name a lie at every
-- call site, and ACKNOWLEDGED has no member to map to at all. Widening the
-- shared one instead would make both representable on every LeaveRequest in
-- the product — the same argument ExpenseClaimStatus already makes.
--
-- `PerformanceReview.reviewerId` is a snapshot of the manager taken when the
-- cycle opens, not a live join. A reorg in April must not hand a half-written
-- H1 review to somebody who has never met the person.
--
-- The permission grants at the bottom are not optional, and are the reason
-- this file is longer than the generated diff. See the comment above them.
-- ─────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "ReviewCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING_SELF', 'PENDING_MANAGER', 'SHARED', 'ACKNOWLEDGED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ReviewCycle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueOn" DATE,
    "minServiceDays" INTEGER NOT NULL DEFAULT 90,
    "status" "ReviewCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "dueOn" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_SELF',
    "selfRating" INTEGER,
    "selfComment" TEXT,
    "selfSubmittedAt" TIMESTAMP(3),
    "managerRating" INTEGER,
    "managerComment" TEXT,
    "managerActions" TEXT,
    "managerSubmittedAt" TIMESTAMP(3),
    "sharedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgeNote" TEXT,
    "reopenNote" TEXT,
    "cancelNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewCycle_organizationId_status_idx" ON "ReviewCycle"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ReviewCycle_organizationId_periodStart_periodEnd_idx" ON "ReviewCycle"("organizationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCycle_organizationId_name_key" ON "ReviewCycle"("organizationId", "name");

-- CreateIndex
CREATE INDEX "PerformanceGoal_cycleId_employeeId_idx" ON "PerformanceGoal"("cycleId", "employeeId");

-- CreateIndex
CREATE INDEX "PerformanceGoal_employeeId_status_idx" ON "PerformanceGoal"("employeeId", "status");

-- CreateIndex
CREATE INDEX "PerformanceGoal_organizationId_cycleId_idx" ON "PerformanceGoal"("organizationId", "cycleId");

-- CreateIndex
CREATE INDEX "PerformanceReview_reviewerId_status_idx" ON "PerformanceReview"("reviewerId", "status");

-- CreateIndex
CREATE INDEX "PerformanceReview_cycleId_status_idx" ON "PerformanceReview"("cycleId", "status");

-- CreateIndex
CREATE INDEX "PerformanceReview_employeeId_createdAt_idx" ON "PerformanceReview"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "PerformanceReview_organizationId_status_idx" ON "PerformanceReview"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceReview_cycleId_employeeId_key" ON "PerformanceReview"("cycleId", "employeeId");

-- AddForeignKey
ALTER TABLE "ReviewCycle" ADD CONSTRAINT "ReviewCycle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceGoal" ADD CONSTRAINT "PerformanceGoal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceGoal" ADD CONSTRAINT "PerformanceGoal_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceGoal" ADD CONSTRAINT "PerformanceGoal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────
-- Permissions, for every organization that already exists.
--
-- docs/04-rbac.md:256-265 requires this of every new module, and the expenses
-- migration did not do it. The consequence was not subtle: the codes existed
-- in the TypeScript catalogue, the guard refused every route, the sidebar
-- entry rendered for nobody, and the only fix available was a destructive
-- re-seed of a live workspace. A tenant that upgrades must not end up with
-- fewer capabilities than a tenant created fresh.
--
-- Written as (role code, permission code) pairs so it reads the same way
-- packages/shared/src/constants/permissions.ts does. Both statements are
-- idempotent, so re-running this migration grants nothing twice, and a grant
-- an administrator has since revoked in Settings is not resurrected by it.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "Permission" ("id", "code", "resource", "action")
SELECT
  'perm_' || replace(code, '.', '_'),
  code,
  split_part(code, '.', 1),
  substring(code from position('.' in code) + 1)
FROM (VALUES
  ('performance.read.own'),
  ('performance.goal.own'),
  ('performance.read.team'),
  ('performance.goal.team'),
  ('performance.review.team'),
  ('performance.read'),
  ('performance.manage')
) AS p(code)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  -- Everybody writes down what they are working on and answers their own
  -- review. Withholding that would only mean self-assessments arrive as Word
  -- documents attached to an email.
  ('ADMIN',    'performance.read.own'),
  ('ADMIN',    'performance.goal.own'),
  ('ADMIN',    'performance.read.team'),
  ('ADMIN',    'performance.goal.team'),
  ('ADMIN',    'performance.review.team'),
  ('ADMIN',    'performance.read'),
  ('ADMIN',    'performance.manage'),
  ('HR',       'performance.read.own'),
  ('HR',       'performance.goal.own'),
  ('HR',       'performance.read.team'),
  ('HR',       'performance.goal.team'),
  ('HR',       'performance.review.team'),
  -- HR reads every review and writes none of them. Where there is no manager
  -- to write one, `manage` reassigns the reviewer rather than standing in.
  ('HR',       'performance.read'),
  ('HR',       'performance.manage'),
  ('MANAGER',  'performance.read.own'),
  ('MANAGER',  'performance.goal.own'),
  ('MANAGER',  'performance.read.team'),
  ('MANAGER',  'performance.goal.team'),
  ('MANAGER',  'performance.review.team'),
  ('FINANCE',  'performance.read.own'),
  ('FINANCE',  'performance.goal.own'),
  ('EMPLOYEE', 'performance.read.own'),
  ('EMPLOYEE', 'performance.goal.own')
-- Aliased `g`, not `grant`: GRANT is a reserved word and an unquoted alias
-- of that name is a syntax error rather than a helpful one.
) AS g(role_code, perm_code) ON r."code" = g.role_code
JOIN "Permission" p ON p."code" = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
