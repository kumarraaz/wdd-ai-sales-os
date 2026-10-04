-- AlterEnum: add new discovery source types (backward compatible — no values removed)
ALTER TYPE "LeadSourceType" ADD VALUE 'GEOAPIFY';
ALTER TYPE "LeadSourceType" ADD VALUE 'OPENSTREETMAP';
ALTER TYPE "LeadSourceType" ADD VALUE 'WEB_SEARCH';
ALTER TYPE "LeadSourceType" ADD VALUE 'META';
ALTER TYPE "LeadSourceType" ADD VALUE 'GOVERNMENT_REGISTRY';

-- AlterTable: discovery workspace fields on Lead
ALTER TABLE "Lead" ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN "websiteStatus" TEXT,
ADD COLUMN "opportunityType" TEXT,
ADD COLUMN "contactable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "googleMapsUrl" TEXT,
ADD COLUMN "instagramUrl" TEXT,
ADD COLUMN "facebookUrl" TEXT,
ADD COLUMN "linkedinUrl" TEXT;

-- CreateTable: saved discovery profiles
CREATE TABLE "DiscoveryProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable: discovery run history
CREATE TABLE "DiscoveryHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "label" TEXT NOT NULL,
    "providerIds" JSONB NOT NULL DEFAULT '[]',
    "params" JSONB NOT NULL,
    "requested" INTEGER NOT NULL,
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "deduplicated" INTEGER NOT NULL DEFAULT 0,
    "withWebsite" INTEGER NOT NULL DEFAULT 0,
    "withoutWebsite" INTEGER NOT NULL DEFAULT 0,
    "contactable" INTEGER NOT NULL DEFAULT 0,
    "unreachable" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "duplicate" INTEGER NOT NULL DEFAULT 0,
    "perSource" JSONB NOT NULL DEFAULT '[]',
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable: zero-spend provider usage ledger
CREATE TABLE "ProviderUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "blockedRequests" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryProfile_organizationId_name_key" ON "DiscoveryProfile"("organizationId", "name");

-- CreateIndex
CREATE INDEX "DiscoveryProfile_organizationId_idx" ON "DiscoveryProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderUsage_organizationId_provider_period_periodStart_key" ON "ProviderUsage"("organizationId", "provider", "period", "periodStart");

-- CreateIndex
CREATE INDEX "ProviderUsage_organizationId_provider_idx" ON "ProviderUsage"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "DiscoveryHistory_organizationId_idx" ON "DiscoveryHistory"("organizationId");

-- CreateIndex
CREATE INDEX "DiscoveryHistory_organizationId_createdAt_idx" ON "DiscoveryHistory"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "DiscoveryProfile" ADD CONSTRAINT "DiscoveryProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryHistory" ADD CONSTRAINT "DiscoveryHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryHistory" ADD CONSTRAINT "DiscoveryHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "DiscoveryProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsage" ADD CONSTRAINT "ProviderUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
