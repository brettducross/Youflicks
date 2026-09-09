-- M3: first-class GeneratedAsset persistence + TimelineClip source discriminator.
-- Do not collapse generated media into MediaAsset. Do not expand RenderJob,
-- FinishedMovie, or Publication beyond unused stubs.

CREATE TABLE "generated_asset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "previewKey" TEXT,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "payload" JSONB NOT NULL,
    "jobId" TEXT,
    "inputFingerprint" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "modelId" TEXT,
    "modelVersion" TEXT,
    "timelineId" TEXT,
    "timelineVersion" INTEGER,
    "storySceneId" TEXT,
    "storyStructureId" TEXT,
    "storyStructureVersion" INTEGER,
    "sourceMediaAssetId" TEXT,
    "replacesAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generated_asset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generated_asset_projectId_createdAt_idx" ON "generated_asset"("projectId", "createdAt");
CREATE INDEX "generated_asset_jobId_idx" ON "generated_asset"("jobId");
CREATE INDEX "generated_asset_timelineId_role_idx" ON "generated_asset"("timelineId", "role");

ALTER TABLE "generated_asset" ADD CONSTRAINT "generated_asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_asset" ADD CONSTRAINT "generated_asset_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "timeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "generated_asset" ADD CONSTRAINT "generated_asset_sourceMediaAssetId_fkey" FOREIGN KEY ("sourceMediaAssetId") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "generated_asset" ADD CONSTRAINT "generated_asset_replacesAssetId_fkey" FOREIGN KEY ("replacesAssetId") REFERENCES "generated_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "timeline_clip" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'MEDIA_ASSET';
ALTER TABLE "timeline_clip" ADD COLUMN "generatedAssetId" TEXT;
ALTER TABLE "timeline_clip" ALTER COLUMN "assetId" DROP NOT NULL;

ALTER TABLE "timeline_clip" ADD CONSTRAINT "timeline_clip_source_identity_check" CHECK (
    ("sourceKind" = 'MEDIA_ASSET' AND "assetId" IS NOT NULL AND "generatedAssetId" IS NULL)
    OR
    ("sourceKind" = 'GENERATED_ASSET' AND "generatedAssetId" IS NOT NULL AND "assetId" IS NULL)
);

ALTER TABLE "timeline_clip" ADD CONSTRAINT "timeline_clip_generatedAssetId_fkey" FOREIGN KEY ("generatedAssetId") REFERENCES "generated_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_attribution" ADD COLUMN "generatedAssetId" TEXT;
CREATE INDEX "provider_attribution_generatedAssetId_idx" ON "provider_attribution"("generatedAssetId");
ALTER TABLE "provider_attribution" ADD CONSTRAINT "provider_attribution_generatedAssetId_fkey" FOREIGN KEY ("generatedAssetId") REFERENCES "generated_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
