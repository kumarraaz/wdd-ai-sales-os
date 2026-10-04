-- Lead quality: persist deterministic score breakdown + opportunity reason
-- Purely additive columns (nullable); safe to deploy on existing data.
ALTER TABLE "Lead" ADD COLUMN "scoreReason" TEXT;
ALTER TABLE "Lead" ADD COLUMN "opportunityReason" TEXT;
