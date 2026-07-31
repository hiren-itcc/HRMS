-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('HEAD_OFFICE', 'BRANCH', 'REMOTE', 'CLIENT_SITE');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "type" "LocationType" NOT NULL DEFAULT 'BRANCH';

-- AlterTable: employment type becomes a managed entity (enum -> table).
-- Employee is empty pre-launch, so the column swap loses no data.
ALTER TABLE "Employee" DROP COLUMN "employmentType";

-- DropEnum (must precede CREATE TABLE — PG tables and types share a namespace)
DROP TYPE "EmploymentType";

-- CreateTable
CREATE TABLE "EmploymentType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,

    CONSTRAINT "EmploymentType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentType_organizationId_name_key" ON "EmploymentType"("organizationId", "name");

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "employmentTypeId" TEXT;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_employmentTypeId_fkey" FOREIGN KEY ("employmentTypeId") REFERENCES "EmploymentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
