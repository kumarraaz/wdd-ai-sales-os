-- WDD AI Sales OS — autonomous AI sales agent phase.
-- Additive only: verification fields, follower provenance, run stats,
-- new statuses, notifications. No existing data touched.

-- New enum values (additive; existing rows unaffected).
ALTER TYPE "LeadStatus" ADD VALUE 'VERIFIED';
ALTER TYPE "LeadStatus" ADD VALUE 'FOLLOW_UP';
ALTER TYPE "LeadStatus" ADD VALUE 'CONVERTED';
ALTER TYPE "LeadStatus" ADD VALUE 'NOT_RELEVANT';
ALTER TYPE "ProspectingRunStatus" ADD VALUE 'PARTIAL';

CREATE TYPE "VerificationConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'REJECTED');
CREATE TYPE "FollowerCountStatus" AS ENUM ('UNKNOWN', 'VERIFIED', 'UNVERIFIED');

-- Lead: verification + provenance + follower fields (all nullable/additive).
ALTER TABLE "Lead" ADD COLUMN "verificationConfidence" "VerificationConfidence";
ALTER TABLE "Lead" ADD COLUMN "verificationReason" TEXT;
ALTER TABLE "Lead" ADD COLUMN "verificationSources" JSONB;
ALTER TABLE "Lead" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "industryRelevance" INTEGER;
ALTER TABLE "Lead" ADD COLUMN "industryReasoning" TEXT;
ALTER TABLE "Lead" ADD COLUMN "followerCount" INTEGER;
ALTER TABLE "Lead" ADD COLUMN "followerCountStatus" "FollowerCountStatus" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Lead" ADD COLUMN "mergedSourceTypes" JSONB;

-- Run: transparency stats for the agent pipeline.
ALTER TABLE "InstagramProspectingRun" ADD COLUMN "verified" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InstagramProspectingRun" ADD COLUMN "rejected" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InstagramProspectingRun" ADD COLUMN "sourceBreakdown" JSONB;
ALTER TABLE "InstagramProspectingRun" ADD COLUMN "durationMs" INTEGER;

-- Notifications: metadata for structured payloads (run stats etc.).
ALTER TABLE "Notification" ADD COLUMN "metadata" JSONB;
