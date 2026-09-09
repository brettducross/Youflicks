-- M8.3: ops usage metering + engine cost attribution.
-- UsageEvent is append-only and separate from GenerationAuthorization (M8.2).
-- EngineCostEvent is ops/finance only — never a creative input.
-- Not Invoice / Subscription / CreditLedger / BillingPort (M8.5).
-- Not a creative table.

CREATE TABLE "usage_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'SUCCEEDED',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "engine_cost_event" (
    "id" TEXT NOT NULL,
    "usageEventId" TEXT NOT NULL,
    "jobId" TEXT,
    "providerKey" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "costUnits" DOUBLE PRECISION NOT NULL,
    "costKind" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_cost_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usage_event_userId_kind_recordedAt_idx" ON "usage_event"("userId", "kind", "recordedAt");
CREATE INDEX "usage_event_jobId_idx" ON "usage_event"("jobId");
CREATE INDEX "usage_event_projectId_idx" ON "usage_event"("projectId");
CREATE INDEX "engine_cost_event_usageEventId_idx" ON "engine_cost_event"("usageEventId");
CREATE INDEX "engine_cost_event_jobId_idx" ON "engine_cost_event"("jobId");
CREATE INDEX "engine_cost_event_providerKey_capability_idx" ON "engine_cost_event"("providerKey", "capability");

ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engine_cost_event" ADD CONSTRAINT "engine_cost_event_usageEventId_fkey" FOREIGN KEY ("usageEventId") REFERENCES "usage_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
