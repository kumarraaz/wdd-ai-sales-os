-- Instagram Outreach Assistant: humanized pitch upgrade.
-- Purely additive, nullable columns on InstagramOutreachItem. Safe to deploy
-- on existing data; existing drafts keep working.
ALTER TABLE "InstagramOutreachItem" ADD COLUMN "pitchAngle" TEXT;
ALTER TABLE "InstagramOutreachItem" ADD COLUMN "websiteAnalysis" TEXT;
