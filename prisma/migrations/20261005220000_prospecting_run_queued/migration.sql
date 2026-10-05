-- Add QUEUED to ProspectingRunStatus so a manually triggered run is visible
-- in run history from the moment it is enqueued (before the job executes).
ALTER TYPE "ProspectingRunStatus" ADD VALUE 'QUEUED';
