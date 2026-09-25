-- SG PR-1: lane-priced gateway reservations and AI-video seconds/budget ledgers.
-- Additive only. No enums, drops, or renames. CreativePlan / Story / Timeline /
-- GeneratedAsset / Render / entitlement tables are unchanged.

-- AlterTable
ALTER TABLE "gateway_spend_ledger" ADD COLUMN     "billedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "reservedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "reservedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scopeKind" TEXT NOT NULL DEFAULT 'GLOBAL';

-- CreateTable
CREATE TABLE "gateway_spend_reservation" (
    "id" TEXT NOT NULL,
    "ledgerIds" TEXT[],
    "laneId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "modelId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "gatewayJobId" TEXT,
    "requestedDurationS" DOUBLE PRECISION NOT NULL,
    "estimatedBilledSeconds" DOUBLE PRECISION NOT NULL,
    "usdPerSecond" DOUBLE PRECISION NOT NULL,
    "reservedUsd" DOUBLE PRECISION NOT NULL,
    "actualBilledSeconds" DOUBLE PRECISION,
    "actualUsd" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "settleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "gateway_spend_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_video_budget_ledger" (
    "id" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "windowKey" TEXT,
    "reservedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "committedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "committedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_video_budget_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_video_budget_reservation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ledgerIds" TEXT[],
    "laneId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "estimatedBilledSeconds" DOUBLE PRECISION NOT NULL,
    "usdPerSecond" DOUBLE PRECISION NOT NULL,
    "estimatedUsd" DOUBLE PRECISION NOT NULL,
    "actualBilledSeconds" DOUBLE PRECISION,
    "actualUsd" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "settleReason" TEXT,
    "gatewayReservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "ai_video_budget_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_spend_reservation_idempotencyKey_key" ON "gateway_spend_reservation"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_spend_reservation_gatewayJobId_key" ON "gateway_spend_reservation"("gatewayJobId");

-- CreateIndex
CREATE INDEX "gateway_spend_reservation_laneId_createdAt_idx" ON "gateway_spend_reservation"("laneId", "createdAt");

-- CreateIndex
CREATE INDEX "gateway_spend_reservation_status_createdAt_idx" ON "gateway_spend_reservation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ai_video_budget_ledger_projectId_idx" ON "ai_video_budget_ledger"("projectId");

-- CreateIndex
CREATE INDEX "ai_video_budget_ledger_userId_windowKey_idx" ON "ai_video_budget_ledger"("userId", "windowKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_video_budget_reservation_idempotencyKey_key" ON "ai_video_budget_reservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ai_video_budget_reservation_projectId_createdAt_idx" ON "ai_video_budget_reservation"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_video_budget_reservation_userId_createdAt_idx" ON "ai_video_budget_reservation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_video_budget_reservation_status_idx" ON "ai_video_budget_reservation"("status");

-- AddForeignKey
ALTER TABLE "ai_video_budget_reservation" ADD CONSTRAINT "ai_video_budget_reservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
