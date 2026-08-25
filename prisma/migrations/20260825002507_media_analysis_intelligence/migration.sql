-- AlterTable
ALTER TABLE "media_analysis" ADD COLUMN     "analyzedAt" TIMESTAMP(3),
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "modelVersion" TEXT,
ADD COLUMN     "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
ALTER COLUMN "status" SET DEFAULT 'QUEUED';

-- AlterTable
ALTER TABLE "media_asset" ADD COLUMN     "analysisStatus" TEXT NOT NULL DEFAULT 'NOT_ANALYZED';
