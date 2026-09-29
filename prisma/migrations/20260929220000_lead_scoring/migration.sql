-- AlterTable
ALTER TABLE "LeadScore" ADD COLUMN     "aiAssessment" JSONB,
ADD COLUMN     "aiEnriched" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confidence" TEXT,
ADD COLUMN     "evidence" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "factors" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'deterministic',
ADD COLUMN     "scoreBand" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "scoringVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "warnings" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "UsageCounter" ADD COLUMN     "leadScoring" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "leadScoringPerDay" INTEGER NOT NULL DEFAULT 100;

-- CreateIndex
CREATE INDEX "LeadScore_organizationId_leadId_idx" ON "LeadScore"("organizationId", "leadId");

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

