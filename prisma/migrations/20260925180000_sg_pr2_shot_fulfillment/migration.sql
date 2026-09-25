-- SG PR-2: fulfillment-side per-shot records.
-- Additive only. New tables. No enums, drops, renames, or changes to
-- GeneratedAsset, Timeline, CreativePlan, or StoryDocument columns.

-- CreateTable
CREATE TABLE "shot_fulfillment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "timelineVersion" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "storySceneId" TEXT,
    "slotKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requiredScopes" TEXT[],
    "shotRole" TEXT,
    "identityState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "identityEvidence" JSONB,
    "motionNeed" TEXT,
    "slotDurationMs" INTEGER,
    "treatment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "routingMode" TEXT NOT NULL,
    "shadowDecision" JSONB,
    "currentLaneClass" TEXT,
    "currentLaneId" TEXT,
    "currentProviderKey" TEXT,
    "attemptsTotal" INTEGER NOT NULL DEFAULT 0,
    "decisionReason" TEXT NOT NULL,
    "userMessageKey" TEXT,
    "registryVersion" TEXT NOT NULL,
    "registrySha256" TEXT NOT NULL,
    "treatmentParams" JSONB,
    "generatedAssetId" TEXT,
    "sourceMediaAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shot_fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shot_fulfillment_attempt" (
    "id" TEXT NOT NULL,
    "shotFulfillmentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "classAttemptNo" INTEGER NOT NULL,
    "laneClass" TEXT NOT NULL,
    "laneId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "modelId" TEXT,
    "requiredScopes" TEXT[],
    "jobId" TEXT,
    "gatewayJobId" TEXT,
    "budgetReservationId" TEXT,
    "gatewayReservationId" TEXT,
    "estimatedBilledSeconds" DOUBLE PRECISION NOT NULL,
    "actualBilledSeconds" DOUBLE PRECISION,
    "usdPerSecond" DOUBLE PRECISION NOT NULL,
    "estimatedUsd" DOUBLE PRECISION NOT NULL,
    "actualUsd" DOUBLE PRECISION,
    "outcome" TEXT NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "keepSignal" TEXT,
    "outputWidth" INTEGER,
    "outputHeight" INTEGER,
    "generatedAssetId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "shot_fulfillment_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shot_fulfillment_projectId_slotKey_key" ON "shot_fulfillment"("projectId", "slotKey");

-- CreateIndex
CREATE INDEX "shot_fulfillment_projectId_createdAt_idx" ON "shot_fulfillment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "shot_fulfillment_timelineId_role_idx" ON "shot_fulfillment"("timelineId", "role");

-- CreateIndex
CREATE INDEX "shot_fulfillment_status_idx" ON "shot_fulfillment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shot_fulfillment_attempt_shotFulfillmentId_attemptNo_key" ON "shot_fulfillment_attempt"("shotFulfillmentId", "attemptNo");

-- CreateIndex
CREATE INDEX "shot_fulfillment_attempt_laneId_startedAt_idx" ON "shot_fulfillment_attempt"("laneId", "startedAt");

-- CreateIndex
CREATE INDEX "shot_fulfillment_attempt_providerKey_idx" ON "shot_fulfillment_attempt"("providerKey");

-- CreateIndex
CREATE INDEX "shot_fulfillment_attempt_jobId_idx" ON "shot_fulfillment_attempt"("jobId");

-- AddForeignKey
ALTER TABLE "shot_fulfillment" ADD CONSTRAINT "shot_fulfillment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_fulfillment_attempt" ADD CONSTRAINT "shot_fulfillment_attempt_shotFulfillmentId_fkey" FOREIGN KEY ("shotFulfillmentId") REFERENCES "shot_fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
