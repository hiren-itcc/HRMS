-- Helpdesk: tickets, a thread, and the desks they route to.
--
-- Three tables, three enums, and — checked by eye before this shipped — zero
-- DROP, zero ALTER COLUMN, and no ALTER TABLE against any table that already
-- existed. The eight ALTER TABLEs below are all ADD CONSTRAINT on the three
-- new ones. Organization, Employee and User gain Prisma relation arrays, which
-- emit no DDL at all.
--
-- ApprovalStatus is deliberately not reused. A ticket is never approved and
-- never rejected; WAITING_ON_REQUESTER and RESOLVED have no member to map to,
-- and widening the shared enum to fit would make both representable on every
-- LeaveRequest in the product.
--
-- TicketCommentKind carries a SYSTEM member instead of this module having a
-- status-history table. Transitions write a terse entry onto the thread the
-- requester already reads, while AuditLog keeps the tamper-evident copy for
-- whoever holds audit.read — which only Admin does, so an audit-only design
-- would mean the person who raised the ticket could not see its history at all.

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketCommentKind" AS ENUM ('PUBLIC', 'INTERNAL', 'SYSTEM');

-- CreateTable
CREATE TABLE "TicketCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultAssigneeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "resolution" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" "TicketCommentKind" NOT NULL DEFAULT 'PUBLIC',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketCategory_organizationId_active_idx" ON "TicketCategory"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TicketCategory_organizationId_name_key" ON "TicketCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Ticket_organizationId_status_idx" ON "Ticket"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Ticket_organizationId_assigneeId_status_idx" ON "Ticket"("organizationId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "Ticket_requesterId_createdAt_idx" ON "Ticket"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_categoryId_status_idx" ON "Ticket"("categoryId", "status");

-- CreateIndex
CREATE INDEX "TicketComment_ticketId_createdAt_idx" ON "TicketComment"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_defaultAssigneeId_fkey" FOREIGN KEY ("defaultAssigneeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Permissions ──────────────────────────────────────────────────────
--
-- Not optional, and the reason this block exists at all: the expenses module
-- shipped without one. Its codes reached the catalogue in TypeScript but never
-- reached the database, so the sidebar entry was invisible to every role and
-- the only fix anybody found was a destructive re-seed. A module's migration
-- grants its own codes or the module does not work.
--
-- Both statements are idempotent, so re-running grants nothing twice — and a
-- grant an administrator has since revoked in Settings is not resurrected.

INSERT INTO "Permission" ("id", "code", "resource", "action")
SELECT
  'perm_' || replace(code, '.', '_'),
  code,
  split_part(code, '.', 1),
  substring(code from position('.' in code) + 1)
FROM (VALUES
  ('helpdesk.read.own'),
  ('helpdesk.raise.own'),
  ('helpdesk.read'),
  ('helpdesk.respond'),
  ('helpdesk.manage')
) AS p(code)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  -- Asking the company a question, and reading the answer. Everybody gets
  -- both: a helpdesk only some people may write to is a helpdesk whose queue
  -- is somebody's inbox instead.
  ('ADMIN',    'helpdesk.read.own'),
  ('ADMIN',    'helpdesk.raise.own'),
  ('ADMIN',    'helpdesk.read'),
  ('ADMIN',    'helpdesk.respond'),
  ('ADMIN',    'helpdesk.manage'),
  -- HR is the desk out of the box, because in a company with no separate IT
  -- or facilities function it is who the questions were already going to.
  ('HR',       'helpdesk.read.own'),
  ('HR',       'helpdesk.raise.own'),
  ('HR',       'helpdesk.read'),
  ('HR',       'helpdesk.respond'),
  ('HR',       'helpdesk.manage'),
  ('FINANCE',  'helpdesk.read.own'),
  ('FINANCE',  'helpdesk.raise.own'),
  -- A manager holds nothing beyond their own two, on purpose. A ticket may be
  -- a payslip query, a grievance about a manager, or a request to correct a
  -- date of birth — and the manager it concerns is exactly who must not read
  -- it by default. An organization that wants team leads on a desk grants
  -- `helpdesk.respond` to a role composed in Settings; that needs no code.
  ('MANAGER',  'helpdesk.read.own'),
  ('MANAGER',  'helpdesk.raise.own'),
  ('EMPLOYEE', 'helpdesk.read.own'),
  ('EMPLOYEE', 'helpdesk.raise.own')
-- Aliased `g`, not `grant`: GRANT is a reserved word and an unquoted alias of
-- that name is a syntax error rather than a helpful one.
) AS g(role_code, perm_code) ON r."code" = g.role_code
JOIN "Permission" p ON p."code" = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
