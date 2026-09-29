-- AlterTable
ALTER TABLE "UsageCounter" ADD COLUMN     "aiIntelligence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "aiIntelligencePerDay" INTEGER NOT NULL DEFAULT 25;

-- CreateTable
CREATE TABLE "LeadIntelligence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "companyId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "schemaVersion" TEXT NOT NULL DEFAULT 'v1',
    "intelligence" JSONB NOT NULL DEFAULT '{}',
    "confidence" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadIntelligence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadIntelligence_organizationId_idx" ON "LeadIntelligence"("organizationId");

-- CreateIndex
CREATE INDEX "LeadIntelligence_organizationId_leadId_idx" ON "LeadIntelligence"("organizationId", "leadId");

-- CreateIndex
CREATE INDEX "LeadIntelligence_leadId_createdAt_idx" ON "LeadIntelligence"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "LeadIntelligence" ADD CONSTRAINT "LeadIntelligence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIntelligence" ADD CONSTRAINT "LeadIntelligence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIntelligence" ADD CONSTRAINT "LeadIntelligence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

