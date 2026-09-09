-- M2: harden first-class Timeline + TimelineClip persistence and provenance.
-- Do not change CreativePlan, StoryStructure narrative schema, RenderJob,
-- FinishedMovie, or Publication beyond leaving those stubs unused.

-- Table was unused before M2. Clear any leftover stub rows before NOT NULL.
DELETE FROM "timeline_clip";
DELETE FROM "timeline";

ALTER TABLE "timeline" ADD COLUMN "jobId" TEXT;
ALTER TABLE "timeline" ADD COLUMN "inputFingerprint" TEXT;
ALTER TABLE "timeline" ADD COLUMN "storyStructureVersion" INTEGER;
ALTER TABLE "timeline" ADD COLUMN "storyFingerprint" TEXT;
ALTER TABLE "timeline" ADD COLUMN "creativePlanId" TEXT;
ALTER TABLE "timeline" ADD COLUMN "creativePlanVersion" INTEGER;
ALTER TABLE "timeline" ADD COLUMN "providerKey" TEXT;
ALTER TABLE "timeline" ADD COLUMN "capability" TEXT;
ALTER TABLE "timeline" ADD COLUMN "modelId" TEXT;
ALTER TABLE "timeline" ADD COLUMN "modelVersion" TEXT;

ALTER TABLE "timeline" ALTER COLUMN "inputFingerprint" SET NOT NULL;
ALTER TABLE "timeline" ALTER COLUMN "storyStructureId" SET NOT NULL;
ALTER TABLE "timeline" ALTER COLUMN "storyStructureVersion" SET NOT NULL;
ALTER TABLE "timeline" ALTER COLUMN "capability" SET NOT NULL;
ALTER TABLE "timeline" ALTER COLUMN "providerKey" SET NOT NULL;
ALTER TABLE "timeline" ALTER COLUMN "version" DROP DEFAULT;

ALTER TABLE "timeline" DROP CONSTRAINT "timeline_storyStructureId_fkey";
ALTER TABLE "timeline" ADD CONSTRAINT "timeline_storyStructureId_fkey" FOREIGN KEY ("storyStructureId") REFERENCES "story_structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "timeline_projectId_createdAt_idx" ON "timeline"("projectId", "createdAt");
CREATE INDEX "timeline_jobId_idx" ON "timeline"("jobId");

ALTER TABLE "timeline_clip" ALTER COLUMN "assetId" SET NOT NULL;
ALTER TABLE "timeline_clip" ALTER COLUMN "startMs" DROP DEFAULT;
ALTER TABLE "timeline_clip" ALTER COLUMN "endMs" DROP DEFAULT;

ALTER TABLE "timeline_clip" DROP CONSTRAINT "timeline_clip_assetId_fkey";
ALTER TABLE "timeline_clip" ADD CONSTRAINT "timeline_clip_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
