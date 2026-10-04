-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('OUTREACH_DRAFT', 'CRM_FOLLOWUP', 'CRM_TASK');

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "actionType" "ApprovalActionType" NOT NULL,
    "proposedInput" JSONB NOT NULL,
    "target" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "executionResult" JSONB,
    "workflowSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentApproval_organizationId_status_idx" ON "AgentApproval"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AgentApproval_organizationId_createdAt_idx" ON "AgentApproval"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
