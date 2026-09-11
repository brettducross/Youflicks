-- Wave 1 closed beta: invite allowlist/codes, AI processing consent,
-- durable gateway spend ledger. Not CreativePlan / Story / Timeline.

CREATE TABLE "beta_invite" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "codeHash" TEXT,
    "preVerifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "consumedAt" TIMESTAMP(3),
    "consumedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beta_invite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "beta_invite_codeHash_key" ON "beta_invite"("codeHash");
CREATE INDEX "beta_invite_email_idx" ON "beta_invite"("email");

ALTER TABLE "beta_invite" ADD CONSTRAINT "beta_invite_consumedByUserId_fkey" FOREIGN KEY ("consumedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ai_processing_consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_processing_consent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_processing_consent_userId_policyVersion_key" ON "ai_processing_consent"("userId", "policyVersion");
CREATE INDEX "ai_processing_consent_userId_acceptedAt_idx" ON "ai_processing_consent"("userId", "acceptedAt");

ALTER TABLE "ai_processing_consent" ADD CONSTRAINT "ai_processing_consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "gateway_spend_ledger" (
    "id" TEXT NOT NULL,
    "jobsAccepted" INTEGER NOT NULL DEFAULT 0,
    "spendUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_spend_ledger_pkey" PRIMARY KEY ("id")
);
