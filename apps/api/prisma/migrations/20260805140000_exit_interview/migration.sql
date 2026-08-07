-- ─────────────────────────────────────────────────────────────────────
-- The exit interview.
--
-- One table, additive, one row per offboarding at most.
--
-- `responses` is JSON rather than a child table because each answer carries
-- the question it answered frozen beside it. The questionnaire is a shipped
-- constant that will change between releases, and an exit interview is
-- evidence — evidence whose question can be edited after the fact is not
-- evidence. Normalising it would make the question a joined row that a later
-- release could rewrite.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE "ExitInterview" (
  "id"             TEXT NOT NULL,
  "offboardingId"  TEXT NOT NULL,
  "conductedOn"    DATE,
  "conductedById"  TEXT,
  "responses"      JSONB NOT NULL DEFAULT '[]',
  "notes"          TEXT,
  "wouldRecommend" BOOLEAN,
  "rehireEligible" BOOLEAN,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExitInterview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExitInterview_offboardingId_key" ON "ExitInterview"("offboardingId");

ALTER TABLE "ExitInterview" ADD CONSTRAINT "ExitInterview_offboardingId_fkey"
  FOREIGN KEY ("offboardingId") REFERENCES "Offboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
