-- M4: harden RenderJob with timeline provenance, fingerprint, capability,
-- and opaque output metadata. Do not productize FinishedMovie or Publication.
-- Phase 1 stub rows cannot be valid M4 jobs (no manifest / fingerprint).

DELETE FROM "render_job";

ALTER TABLE "render_job" ALTER COLUMN "timelineId" SET NOT NULL;

ALTER TABLE "render_job" ADD COLUMN "timelineVersion" INTEGER NOT NULL;
ALTER TABLE "render_job" ADD COLUMN "jobId" TEXT;
ALTER TABLE "render_job" ADD COLUMN "inputFingerprint" TEXT NOT NULL;
ALTER TABLE "render_job" ADD COLUMN "capability" TEXT NOT NULL;
ALTER TABLE "render_job" ADD COLUMN "modelId" TEXT;
ALTER TABLE "render_job" ADD COLUMN "modelVersion" TEXT;
ALTER TABLE "render_job" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "render_job" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "render_job" ADD COLUMN "byteSize" BIGINT;
ALTER TABLE "render_job" ADD COLUMN "checksum" TEXT;

ALTER TABLE "render_job" DROP CONSTRAINT "render_job_timelineId_fkey";
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "timeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "render_job_jobId_idx" ON "render_job"("jobId");
CREATE INDEX "render_job_timelineId_timelineVersion_idx" ON "render_job"("timelineId", "timelineVersion");
CREATE INDEX "render_job_projectId_inputFingerprint_idx" ON "render_job"("projectId", "inputFingerprint");
