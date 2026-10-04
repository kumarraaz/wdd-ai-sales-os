-- 7-day Instagram prospecting plan + daily runs + source-wise CRM.
-- Additive only: new enum value, new Lead columns (nullable/defaulted),
-- three new tables. Existing data untouched.

-- New source type for Instagram-prospected leads
ALTER TYPE "LeadSourceType" ADD VALUE 'INSTAGRAM';

-- Instagram connection status (never guessed; UNKNOWN until verified/set)
CREATE TYPE "InstagramConnectionStatus" AS ENUM ('CONNECTED', 'NOT_CONNECTED', 'UNKNOWN');
CREATE TYPE "ProspectingRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- Lead: Instagram prospecting fields
ALTER TABLE "Lead" ADD COLUMN "instagramUsername" TEXT;
ALTER TABLE "Lead" ADD COLUMN "instagramConnectionStatus" "InstagramConnectionStatus" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Lead" ADD COLUMN "aiMessage" TEXT;
ALTER TABLE "Lead" ADD COLUMN "aiMessageSource" TEXT;
ALTER TABLE "Lead" ADD COLUMN "aiMessageAt" TIMESTAMP(3);
CREATE INDEX "Lead_organizationId_instagramUsername_idx" ON "Lead"("organizationId", "instagramUsername");

-- Weekly prospecting plan (one target per weekday)
CREATE TABLE "InstagramProspectingPlan" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Weekly Instagram Prospecting',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "runAtTime" TEXT NOT NULL DEFAULT '09:00',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramProspectingPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InstagramProspectingPlan_organizationId_idx" ON "InstagramProspectingPlan"("organizationId");
CREATE INDEX "InstagramProspectingPlan_organizationId_isActive_idx" ON "InstagramProspectingPlan"("organizationId", "isActive");
ALTER TABLE "InstagramProspectingPlan" ADD CONSTRAINT "InstagramProspectingPlan_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-weekday target configuration
CREATE TABLE "InstagramProspectingDay" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "industry" TEXT NOT NULL,
  "location" TEXT,
  "country" TEXT,
  "businessType" TEXT,
  "targetAudience" TEXT,
  "websitePreference" TEXT NOT NULL DEFAULT 'ANY',
  "followerThreshold" INTEGER,
  "targetCount" INTEGER NOT NULL DEFAULT 75,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "InstagramProspectingDay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InstagramProspectingDay_planId_dayOfWeek_key" UNIQUE ("planId", "dayOfWeek")
);
CREATE INDEX "InstagramProspectingDay_planId_idx" ON "InstagramProspectingDay"("planId");
ALTER TABLE "InstagramProspectingDay" ADD CONSTRAINT "InstagramProspectingDay_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "InstagramProspectingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Daily run history / statistics
CREATE TABLE "InstagramProspectingRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planId" TEXT,
  "dayOfWeek" INTEGER NOT NULL,
  "runDate" TEXT NOT NULL,
  "targetCount" INTEGER NOT NULL,
  "found" INTEGER NOT NULL DEFAULT 0,
  "newCount" INTEGER NOT NULL DEFAULT 0,
  "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,
  "researched" INTEGER NOT NULL DEFAULT 0,
  "messagesGenerated" INTEGER NOT NULL DEFAULT 0,
  "crmImported" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "status" "ProspectingRunStatus" NOT NULL DEFAULT 'RUNNING',
  "triggeredBy" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "InstagramProspectingRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InstagramProspectingRun_organizationId_runDate_key" UNIQUE ("organizationId", "runDate")
);
CREATE INDEX "InstagramProspectingRun_organizationId_idx" ON "InstagramProspectingRun"("organizationId");
CREATE INDEX "InstagramProspectingRun_organizationId_runDate_idx" ON "InstagramProspectingRun"("organizationId", "runDate");
ALTER TABLE "InstagramProspectingRun" ADD CONSTRAINT "InstagramProspectingRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstagramProspectingRun" ADD CONSTRAINT "InstagramProspectingRun_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "InstagramProspectingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
