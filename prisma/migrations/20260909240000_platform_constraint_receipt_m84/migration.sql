-- M8.4: persist ALLOW constraints as a non-creative receipt on the
-- generation_authorization meter row. Render / keep / export / playback
-- policy read these flags. Never CreativePlan / Story / Timeline meaning.

ALTER TABLE "generation_authorization" ADD COLUMN "maxOutputDurationMs" INTEGER;
ALTER TABLE "generation_authorization" ADD COLUMN "watermarkRequired" BOOLEAN;
ALTER TABLE "generation_authorization" ADD COLUMN "adsEnabled" BOOLEAN;

CREATE INDEX "generation_authorization_projectId_recordedAt_idx" ON "generation_authorization"("projectId", "recordedAt");
