-- Recruitment: the front of the employee lifecycle.
--
-- Five tables and six enums. Nothing existing is altered -- a Candidate is not
-- an Employee, and the only place the two halves meet is Offer.hiredEmployeeId,
-- which is nullable and points at Employee rather than the other way round.
--
-- Generated with `prisma migrate diff --from-empty --to-schema` and reduced to
-- the new objects, the way the last four migrations here were written.

-- CreateEnum
CREATE TYPE "OpeningStatus" AS ENUM ('DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('SKILLS', 'EXPERIENCE', 'COMPENSATION', 'LOCATION', 'NOTICE_PERIOD', 'CULTURE_FIT', 'POSITION_CLOSED', 'CANDIDATE_WITHDREW', 'OTHER');

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('IN_PERSON', 'VIDEO', 'PHONE');

-- CreateEnum
CREATE TYPE "InterviewRecommendation" AS ENUM ('STRONG_YES', 'YES', 'NO', 'STRONG_NO');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateTable
CREATE TABLE "JobOpening" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "locationId" TEXT,
    "employmentTypeId" TEXT,
    "hiringManagerId" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "status" "OpeningStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "minMonthlyCtc" DECIMAL(14,2),
    "maxMonthlyCtc" DECIMAL(14,2),
    "openedOn" DATE,
    "closedOn" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "currentEmployer" TEXT,
    "currentTitle" TEXT,
    "noticePeriodDays" INTEGER,
    "expectedMonthlyCtc" DECIMAL(14,2),
    "source" TEXT,
    "referrerId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "rejectionReason" "RejectionReason",
    "rejectionNote" TEXT,
    "appliedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "resumeDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "interviewerId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 45,
    "mode" "InterviewMode" NOT NULL DEFAULT 'VIDEO',
    "round" TEXT,
    "recommendation" "InterviewRecommendation",
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "designationId" TEXT,
    "departmentId" TEXT,
    "locationId" TEXT,
    "employmentTypeId" TEXT,
    "monthlyCtc" DECIMAL(14,2) NOT NULL,
    "joinDate" DATE NOT NULL,
    "expiresOn" DATE,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "hiredEmployeeId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobOpening_organizationId_status_idx" ON "JobOpening"("organizationId", "status");

-- CreateIndex
CREATE INDEX "JobOpening_hiringManagerId_status_idx" ON "JobOpening"("hiringManagerId", "status");

-- CreateIndex
CREATE INDEX "Candidate_organizationId_createdAt_idx" ON "Candidate"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_organizationId_email_key" ON "Candidate"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Application_resumeDocumentId_key" ON "Application"("resumeDocumentId");

-- CreateIndex
CREATE INDEX "Application_organizationId_stage_idx" ON "Application"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "Application_openingId_stage_idx" ON "Application"("openingId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Application_candidateId_openingId_key" ON "Application"("candidateId", "openingId");

-- CreateIndex
CREATE INDEX "Interview_applicationId_scheduledFor_idx" ON "Interview"("applicationId", "scheduledFor");

-- CreateIndex
CREATE INDEX "Interview_interviewerId_scheduledFor_idx" ON "Interview"("interviewerId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_applicationId_key" ON "Offer"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_hiredEmployeeId_key" ON "Offer"("hiredEmployeeId");

-- CreateIndex
CREATE INDEX "Offer_organizationId_status_idx" ON "Offer"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_employmentTypeId_fkey" FOREIGN KEY ("employmentTypeId") REFERENCES "EmploymentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_hiringManagerId_fkey" FOREIGN KEY ("hiringManagerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "JobOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_resumeDocumentId_fkey" FOREIGN KEY ("resumeDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_employmentTypeId_fkey" FOREIGN KEY ("employmentTypeId") REFERENCES "EmploymentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_hiredEmployeeId_fkey" FOREIGN KEY ("hiredEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
