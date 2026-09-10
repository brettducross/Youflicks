-- M8.5a: Subscription + CreditLedger/CreditBalance + PaymentEvent + OfferCatalog.
-- CreditLedger is append-only. EXPIRE is reserved; default expiry policy is NEVER.
-- Prices and numeric PLUS/FAMILY caps stay null until PO supplies them.
-- M8.6a: AdvertisingEvent impression/click persistence for ops queries.
-- Not CreativePlan / Story / Timeline / GeneratedAsset / Render.
-- Not a live payment provider or external ad-network SDK.

CREATE TABLE "subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "externalRef" TEXT,
    "providerKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "source" TEXT,
    "relatedPaymentEventId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_balance" (
    "userId" TEXT NOT NULL,
    "available" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_balance_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "payment_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "providerKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "offer_catalog" (
    "id" TEXT NOT NULL,
    "offerKey" TEXT NOT NULL,
    "offerKind" TEXT NOT NULL,
    "planKey" TEXT,
    "packKey" TEXT,
    "grantShape" JSONB NOT NULL,
    "priceAmount" DOUBLE PRECISION,
    "priceCurrency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_catalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "advertising_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL DEFAULT 'youflicks.first_party',
    "campaignId" TEXT,
    "offerId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertising_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "offer_catalog_offerKey_key" ON "offer_catalog"("offerKey");
CREATE UNIQUE INDEX "payment_event_providerKey_externalId_key" ON "payment_event"("providerKey", "externalId");

CREATE INDEX "subscription_userId_status_idx" ON "subscription"("userId", "status");
CREATE INDEX "subscription_providerKey_externalRef_idx" ON "subscription"("providerKey", "externalRef");
CREATE INDEX "credit_ledger_userId_recordedAt_idx" ON "credit_ledger"("userId", "recordedAt");
CREATE INDEX "credit_ledger_userId_entryType_idx" ON "credit_ledger"("userId", "entryType");
CREATE INDEX "credit_ledger_source_recordedAt_idx" ON "credit_ledger"("source", "recordedAt");
CREATE INDEX "payment_event_userId_createdAt_idx" ON "payment_event"("userId", "createdAt");
CREATE INDEX "offer_catalog_planKey_idx" ON "offer_catalog"("planKey");
CREATE INDEX "offer_catalog_offerKind_idx" ON "offer_catalog"("offerKind");
CREATE INDEX "advertising_event_userId_surface_recordedAt_idx" ON "advertising_event"("userId", "surface", "recordedAt");
CREATE INDEX "advertising_event_kind_recordedAt_idx" ON "advertising_event"("kind", "recordedAt");
CREATE INDEX "advertising_event_surface_recordedAt_idx" ON "advertising_event"("surface", "recordedAt");

ALTER TABLE "subscription" ADD CONSTRAINT "subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_balance" ADD CONSTRAINT "credit_balance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "advertising_event" ADD CONSTRAINT "advertising_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
