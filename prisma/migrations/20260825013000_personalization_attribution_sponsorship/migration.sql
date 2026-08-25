-- CreateTable
CREATE TABLE "taste_profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taste_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taste_preference" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'EXPLICIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taste_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taste_signal" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "payload" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taste_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sponsorship_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "allowSponsorCredits" BOOLEAN NOT NULL DEFAULT false,
    "allowSponsoredEndCard" BOOLEAN NOT NULL DEFAULT false,
    "allowVideoAds" BOOLEAN NOT NULL DEFAULT false,
    "allowPersonalizedSponsoring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sponsorship_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_creative_intent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "purpose" TEXT,
    "audience" TEXT,
    "mood" TEXT,
    "desiredDurationMs" INTEGER,
    "narrativeStyle" TEXT,
    "visualStyle" TEXT,
    "musicStyle" TEXT,
    "explicitInstructions" TEXT,
    "extras" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_creative_intent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_attribution" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT,
    "analysisId" TEXT,
    "jobId" TEXT,
    "providerKey" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "modelId" TEXT,
    "modelVersion" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_attribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "film_credits" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "movieId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "film_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "film_credit_line" (
    "id" TEXT NOT NULL,
    "creditsId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "providerKey" TEXT,
    "creditType" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "logoKey" TEXT,
    "audioKey" TEXT,
    "videoKey" TEXT,
    "linkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "film_credit_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor_campaign" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsor_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor_offer" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "placementKind" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoKey" TEXT,
    "audioKey" TEXT,
    "videoKey" TEXT,
    "linkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsor_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor_placement" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "movieId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ELIGIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsor_placement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "taste_profile_userId_key" ON "taste_profile"("userId");

-- CreateIndex
CREATE INDEX "taste_preference_profileId_dimension_idx" ON "taste_preference"("profileId", "dimension");

-- CreateIndex
CREATE INDEX "taste_signal_profileId_recordedAt_idx" ON "taste_signal"("profileId", "recordedAt");

-- CreateIndex
CREATE INDEX "taste_signal_profileId_kind_idx" ON "taste_signal"("profileId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "user_sponsorship_preference_userId_key" ON "user_sponsorship_preference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_creative_intent_projectId_key" ON "project_creative_intent"("projectId");

-- CreateIndex
CREATE INDEX "provider_attribution_projectId_recordedAt_idx" ON "provider_attribution"("projectId", "recordedAt");

-- CreateIndex
CREATE INDEX "provider_attribution_assetId_idx" ON "provider_attribution"("assetId");

-- CreateIndex
CREATE INDEX "film_credits_projectId_createdAt_idx" ON "film_credits"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "film_credit_line_creditsId_displayOrder_idx" ON "film_credit_line"("creditsId", "displayOrder");

-- CreateIndex
CREATE INDEX "sponsor_ownerId_idx" ON "sponsor"("ownerId");

-- CreateIndex
CREATE INDEX "sponsor_campaign_sponsorId_idx" ON "sponsor_campaign"("sponsorId");

-- CreateIndex
CREATE INDEX "sponsor_offer_campaignId_idx" ON "sponsor_offer"("campaignId");

-- CreateIndex
CREATE INDEX "sponsor_placement_projectId_idx" ON "sponsor_placement"("projectId");

-- AddForeignKey
ALTER TABLE "taste_profile" ADD CONSTRAINT "taste_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taste_preference" ADD CONSTRAINT "taste_preference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "taste_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taste_signal" ADD CONSTRAINT "taste_signal_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "taste_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sponsorship_preference" ADD CONSTRAINT "user_sponsorship_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_creative_intent" ADD CONSTRAINT "project_creative_intent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_attribution" ADD CONSTRAINT "provider_attribution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "film_credits" ADD CONSTRAINT "film_credits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "film_credits" ADD CONSTRAINT "film_credits_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "finished_movie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "film_credit_line" ADD CONSTRAINT "film_credit_line_creditsId_fkey" FOREIGN KEY ("creditsId") REFERENCES "film_credits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor" ADD CONSTRAINT "sponsor_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_campaign" ADD CONSTRAINT "sponsor_campaign_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "sponsor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_offer" ADD CONSTRAINT "sponsor_offer_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "sponsor_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_placement" ADD CONSTRAINT "sponsor_placement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "sponsor_offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_placement" ADD CONSTRAINT "sponsor_placement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_placement" ADD CONSTRAINT "sponsor_placement_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "finished_movie"("id") ON DELETE SET NULL ON UPDATE CASCADE;
