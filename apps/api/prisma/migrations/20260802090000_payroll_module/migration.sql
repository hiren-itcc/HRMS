-- CreateEnum
CREATE TYPE "PayComponentKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "SalaryCalcType" AS ENUM ('FLAT', 'PERCENT_OF_BASIC', 'PERCENT_OF_CTC', 'STATUTORY', 'BALANCE');

-- CreateEnum
CREATE TYPE "SalaryRevisionType" AS ENUM ('JOINING', 'INCREMENT', 'PROMOTION', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'LOCKED', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayslipPaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PayComponent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PayComponentKind" NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "isStatutory" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PayComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StructureLine" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "calcType" "SalaryCalcType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StructureLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSalary" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "monthlyCtc" DECIMAL(14,2) NOT NULL,
    "monthlyTds" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revisionType" "SalaryRevisionType" NOT NULL DEFAULT 'JOINING',
    "reason" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeSalary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "payDate" DATE,
    "notes" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "calculatedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "totalEarnings" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalEmployerCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "departmentName" TEXT,
    "designationName" TEXT,
    "structureName" TEXT NOT NULL,
    "bankName" TEXT,
    "accountNumberMasked" TEXT,
    "ifsc" TEXT,
    "workingDays" DECIMAL(5,2) NOT NULL,
    "lopDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "payableDays" DECIMAL(5,2) NOT NULL,
    "grossEarnings" DECIMAL(14,2) NOT NULL,
    "totalDeductions" DECIMAL(14,2) NOT NULL,
    "employerContribution" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(14,2) NOT NULL,
    "carriedShortfall" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentStatus" "PayslipPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipLine" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    "kind" "PayComponentKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayComponent_organizationId_kind_idx" ON "PayComponent"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponent_organizationId_code_key" ON "PayComponent"("organizationId", "code");

-- CreateIndex
CREATE INDEX "SalaryStructure_organizationId_isActive_idx" ON "SalaryStructure"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructure_organizationId_code_key" ON "SalaryStructure"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StructureLine_structureId_componentId_key" ON "StructureLine"("structureId", "componentId");

-- CreateIndex
CREATE INDEX "EmployeeSalary_employeeId_effectiveFrom_idx" ON "EmployeeSalary"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSalary_employeeId_effectiveFrom_key" ON "EmployeeSalary"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PayrollRun_organizationId_status_idx" ON "PayrollRun"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_organizationId_month_key" ON "PayrollRun"("organizationId", "month");

-- CreateIndex
CREATE INDEX "Payslip_employeeId_createdAt_idx" ON "Payslip"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "Payslip_organizationId_paymentStatus_idx" ON "Payslip"("organizationId", "paymentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_runId_employeeId_key" ON "Payslip"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "PayslipLine_payslipId_idx" ON "PayslipLine"("payslipId");

-- AddForeignKey
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StructureLine" ADD CONSTRAINT "StructureLine_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "SalaryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StructureLine" ADD CONSTRAINT "StructureLine_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalary" ADD CONSTRAINT "EmployeeSalary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalary" ADD CONSTRAINT "EmployeeSalary_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "SalaryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────
-- Payroll RBAC.
--
-- Permissions are global rows; grants are per (organization, role). The
-- FINANCE role is new, so every existing organization gets one — a tenant
-- that upgrades must not be left with nobody able to approve payroll.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "Permission" ("id", "code", "resource", "action")
SELECT
  'perm_' || replace(code, '.', '_'),
  code,
  split_part(code, '.', 1),
  substring(code from position('.' in code) + 1)
FROM (VALUES
  ('payroll.read.own'),
  ('payroll.read.team'),
  ('payroll.read'),
  ('payroll.structure.manage'),
  ('payroll.salary.manage'),
  ('payroll.process'),
  ('payroll.approve'),
  ('payroll.pay')
) AS p(code)
ON CONFLICT ("code") DO NOTHING;

-- One FINANCE role per organization, mirroring the shape the seed writes.
INSERT INTO "Role" ("id", "organizationId", "code", "name", "description", "isSystem")
SELECT
  'role_fin_' || o."id",
  o."id",
  'FINANCE',
  'Finance',
  'Approves and pays payroll; cannot change salaries',
  true
FROM "Organization" o
ON CONFLICT ("organizationId", "code") DO NOTHING;

-- Grants. Written as (role code, permission code) pairs so this reads the
-- same way the TypeScript catalogue does.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  ('ADMIN',   'payroll.read.own'),
  ('ADMIN',   'payroll.read.team'),
  ('ADMIN',   'payroll.read'),
  ('ADMIN',   'payroll.structure.manage'),
  ('ADMIN',   'payroll.salary.manage'),
  ('ADMIN',   'payroll.process'),
  ('ADMIN',   'payroll.approve'),
  ('ADMIN',   'payroll.pay'),
  ('HR',      'payroll.read.own'),
  ('HR',      'payroll.read.team'),
  ('HR',      'payroll.read'),
  ('HR',      'payroll.structure.manage'),
  ('HR',      'payroll.salary.manage'),
  ('HR',      'payroll.process'),
  ('FINANCE', 'payroll.read'),
  ('FINANCE', 'payroll.approve'),
  ('FINANCE', 'payroll.pay'),
  ('FINANCE', 'employee.read'),
  ('FINANCE', 'report.view'),
  ('FINANCE', 'report.export'),
  ('MANAGER', 'payroll.read.own'),
  ('MANAGER', 'payroll.read.team'),
  ('EMPLOYEE','payroll.read.own')
) AS g(role_code, perm_code) ON g.role_code = r."code"
JOIN "Permission" p ON p."code" = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
