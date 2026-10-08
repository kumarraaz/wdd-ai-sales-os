-- Additive diagnostics for AI prospecting runs. No data changes, no drops.
ALTER TABLE "InstagramProspectingRun" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "InstagramProspectingRun" ADD COLUMN "acquisitionNotes" JSONB;
ALTER TABLE "InstagramProspectingRun" ADD COLUMN "processingErrors" JSONB;
ALTER TABLE "InstagramProspectingRun" ADD COLUMN "rejectionReasons" JSONB;
