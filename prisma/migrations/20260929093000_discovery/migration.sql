-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "discoveredAt" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "reviewCount" INTEGER,
ADD COLUMN     "sourceUrl" TEXT;

-- AlterTable
ALTER TABLE "UsageCounter" ADD COLUMN     "discoveryImports" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discoveryRecords" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "discoveryRecordsPerDay" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "discoverySearchesPerDay" INTEGER NOT NULL DEFAULT 20;

-- CreateIndex
CREATE INDEX "Lead_organizationId_sourceType_externalId_idx" ON "Lead"("organizationId", "sourceType", "externalId");

