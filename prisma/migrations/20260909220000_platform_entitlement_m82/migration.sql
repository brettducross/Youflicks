-- M8.2: platform entitlement support — abuse quarantine + authorized
-- MOVIE_GENERATION attempts at the AI_DIRECT enqueue gate.
-- Not UsageEvent / EngineCostEvent (M8.3). Not Subscription / CreditLedger (M8.5).
-- Not a creative table.

CREATE TABLE "account_platform_state" (
    "userId" TEXT NOT NULL,
    "quarantined" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_platform_state_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "generation_authorization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "projectId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_authorization_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generation_authorization_userId_kind_recordedAt_idx" ON "generation_authorization"("userId", "kind", "recordedAt");

ALTER TABLE "account_platform_state" ADD CONSTRAINT "account_platform_state_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "generation_authorization" ADD CONSTRAINT "generation_authorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
