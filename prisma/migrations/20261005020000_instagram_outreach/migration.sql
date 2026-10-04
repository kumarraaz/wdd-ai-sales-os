-- Instagram Outreach Assistant (human-in-the-loop).
-- No credentials, sessions, or tokens are stored — by design there are no
-- columns for them. Sending is always manual by the user.

CREATE TYPE "InstagramOutreachItemStatus" AS ENUM ('DRAFT', 'COPIED', 'CONTACTED');

CREATE TABLE "InstagramOutreachBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT,
  "totalUsernames" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstagramOutreachBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstagramOutreachItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "profileUrl" TEXT NOT NULL,
  "status" "InstagramOutreachItemStatus" NOT NULL DEFAULT 'DRAFT',
  "businessName" TEXT,
  "category" TEXT,
  "location" TEXT,
  "website" TEXT,
  "observations" TEXT,
  "researchSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "researchConfidence" TEXT,
  "researchFailed" BOOLEAN NOT NULL DEFAULT false,
  "researchError" TEXT,
  "researchedAt" TIMESTAMP(3),
  "messageDraft" TEXT,
  "messageSource" TEXT,
  "messageEdited" TEXT,
  "messageEditedAt" TIMESTAMP(3),
  "dataLabel" "DataLabel" NOT NULL DEFAULT 'AI_INFERENCE',
  "leadId" TEXT,
  "copiedAt" TIMESTAMP(3),
  "contactedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramOutreachItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstagramOutreachItem_organizationId_batchId_username_key"
  ON "InstagramOutreachItem"("organizationId", "batchId", "username");
CREATE INDEX "InstagramOutreachBatch_organizationId_idx" ON "InstagramOutreachBatch"("organizationId");
CREATE INDEX "InstagramOutreachBatch_organizationId_createdAt_idx" ON "InstagramOutreachBatch"("organizationId", "createdAt");
CREATE INDEX "InstagramOutreachItem_organizationId_idx" ON "InstagramOutreachItem"("organizationId");
CREATE INDEX "InstagramOutreachItem_batchId_idx" ON "InstagramOutreachItem"("batchId");
CREATE INDEX "InstagramOutreachItem_leadId_idx" ON "InstagramOutreachItem"("leadId");

ALTER TABLE "InstagramOutreachBatch" ADD CONSTRAINT "InstagramOutreachBatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstagramOutreachItem" ADD CONSTRAINT "InstagramOutreachItem_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstagramOutreachItem" ADD CONSTRAINT "InstagramOutreachItem_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "InstagramOutreachBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstagramOutreachItem" ADD CONSTRAINT "InstagramOutreachItem_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
