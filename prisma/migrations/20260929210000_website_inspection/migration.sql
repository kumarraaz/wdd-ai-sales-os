-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "UsageCounter" ADD COLUMN     "websiteInspections" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "websiteInspectionsPerDay" INTEGER NOT NULL DEFAULT 25;

-- CreateTable
CREATE TABLE "WebsiteInspection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT,
    "companyId" TEXT,
    "requestedUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "httpStatus" INTEGER,
    "status" "InspectionStatus" NOT NULL DEFAULT 'QUEUED',
    "findings" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "dataLabel" "DataLabel" NOT NULL DEFAULT 'VERIFIED',
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteInspection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteInspection_organizationId_idx" ON "WebsiteInspection"("organizationId");

-- CreateIndex
CREATE INDEX "WebsiteInspection_organizationId_createdAt_idx" ON "WebsiteInspection"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteInspection_leadId_idx" ON "WebsiteInspection"("leadId");

-- CreateIndex
CREATE INDEX "WebsiteInspection_companyId_idx" ON "WebsiteInspection"("companyId");

-- AddForeignKey
ALTER TABLE "WebsiteInspection" ADD CONSTRAINT "WebsiteInspection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteInspection" ADD CONSTRAINT "WebsiteInspection_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteInspection" ADD CONSTRAINT "WebsiteInspection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

