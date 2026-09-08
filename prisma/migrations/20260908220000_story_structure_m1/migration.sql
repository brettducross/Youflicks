-- M1: harden first-class StoryStructure persistence and provenance.
-- Do not change Timeline, TimelineClip, RenderJob, FinishedMovie, or Publication.

ALTER TABLE "story_structure" ADD COLUMN "jobId" TEXT;
ALTER TABLE "story_structure" ADD COLUMN "inputFingerprint" TEXT;
ALTER TABLE "story_structure" ADD COLUMN "creativePlanId" TEXT;
ALTER TABLE "story_structure" ADD COLUMN "creativePlanVersion" INTEGER;
ALTER TABLE "story_structure" ADD COLUMN "planFingerprint" TEXT;
ALTER TABLE "story_structure" ADD COLUMN "capability" TEXT;
ALTER TABLE "story_structure" ADD COLUMN "modelId" TEXT;
ALTER TABLE "story_structure" ADD COLUMN "modelVersion" TEXT;

-- Table is unused before M1. Required provenance is NOT NULL for new rows.
ALTER TABLE "story_structure" ALTER COLUMN "inputFingerprint" SET NOT NULL;
ALTER TABLE "story_structure" ALTER COLUMN "creativePlanId" SET NOT NULL;
ALTER TABLE "story_structure" ALTER COLUMN "creativePlanVersion" SET NOT NULL;
ALTER TABLE "story_structure" ALTER COLUMN "capability" SET NOT NULL;
ALTER TABLE "story_structure" ALTER COLUMN "providerKey" SET NOT NULL;
ALTER TABLE "story_structure" ALTER COLUMN "version" DROP DEFAULT;

CREATE INDEX "story_structure_projectId_createdAt_idx" ON "story_structure"("projectId", "createdAt");

CREATE INDEX "story_structure_jobId_idx" ON "story_structure"("jobId");
