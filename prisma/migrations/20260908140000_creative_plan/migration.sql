-- Phase 2F: first-class CreativePlan persistence (not StoryStructure).
CREATE TABLE "creative_plan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "plan" JSONB NOT NULL,
    "jobId" TEXT,
    "inputFingerprint" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "modelId" TEXT,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_plan_projectId_version_key" ON "creative_plan"("projectId", "version");

CREATE INDEX "creative_plan_projectId_createdAt_idx" ON "creative_plan"("projectId", "createdAt");

CREATE INDEX "creative_plan_jobId_idx" ON "creative_plan"("jobId");

ALTER TABLE "creative_plan" ADD CONSTRAINT "creative_plan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
