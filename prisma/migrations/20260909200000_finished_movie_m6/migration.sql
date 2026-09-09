-- M6: harden FinishedMovie as an explicit library keep of one SUCCEEDED RenderJob.
-- Durable library fields + READY | ARCHIVED | FAILED. Not Publication product writes.
-- Phase 1 stub rows cannot be valid M6 keeps (optional renderJobId / PROCESSING).

DELETE FROM "publication";
DELETE FROM "finished_movie";

ALTER TABLE "finished_movie" DROP CONSTRAINT "finished_movie_renderJobId_fkey";

ALTER TABLE "finished_movie" ALTER COLUMN "renderJobId" SET NOT NULL;
ALTER TABLE "finished_movie" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "finished_movie" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "finished_movie" ADD COLUMN "byteSize" BIGINT;
ALTER TABLE "finished_movie" ADD COLUMN "checksum" TEXT;
ALTER TABLE "finished_movie" ADD COLUMN "inputFingerprint" TEXT;
ALTER TABLE "finished_movie" ADD COLUMN "keptAt" TIMESTAMP(3);

ALTER TABLE "finished_movie" ADD CONSTRAINT "finished_movie_renderJobId_fkey" FOREIGN KEY ("renderJobId") REFERENCES "render_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "finished_movie_projectId_status_idx" ON "finished_movie"("projectId", "status");
CREATE INDEX "finished_movie_renderJobId_idx" ON "finished_movie"("renderJobId");
