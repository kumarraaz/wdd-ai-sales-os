-- CreateEnum
CREATE TYPE "AgentMemoryScope" AS ENUM ('ORG', 'RUN', 'LEAD');

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "AgentMemoryScope" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemory_organizationId_scope_scopeId_key_key" ON "AgentMemory"("organizationId", "scope", "scopeId", "key");

-- CreateIndex
CREATE INDEX "AgentMemory_organizationId_scope_scopeId_idx" ON "AgentMemory"("organizationId", "scope", "scopeId");

-- CreateIndex
CREATE INDEX "AgentMemory_organizationId_expiresAt_idx" ON "AgentMemory"("organizationId", "expiresAt");

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
