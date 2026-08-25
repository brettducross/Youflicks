import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  TasteDimension,
  TasteOrigin,
  type TasteOriginValue,
} from "@/server/domain/personalization";
import { prisma } from "@/server/db";
import { tasteHintForCapability } from "@/server/personalization/privacy";
import type {
  SponsorshipPreferenceView,
  TastePreferenceView,
  TasteProfileView,
  TasteSignalView,
} from "@/server/personalization/views";

const preferenceSchemaKeys = new Set<string>(Object.values(TasteDimension));

function asOrigin(value: string): TasteOriginValue {
  return value === TasteOrigin.INFERRED ? TasteOrigin.INFERRED : TasteOrigin.EXPLICIT;
}

export class TasteService {
  toPreferenceView(row: {
    id: string;
    dimension: string;
    value: string;
    source: string;
  }): TastePreferenceView {
    return {
      id: row.id,
      dimension: row.dimension,
      value: row.value,
      source: asOrigin(row.source),
    };
  }

  toSignalView(row: {
    id: string;
    kind: string;
    origin: string;
    payload: Prisma.JsonValue;
    recordedAt: Date;
  }): TasteSignalView {
    return {
      id: row.id,
      kind: row.kind,
      origin: asOrigin(row.origin),
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      recordedAt: row.recordedAt.toISOString(),
    };
  }

  toProfileView(row: {
    id: string;
    userId: string;
    notes: string | null;
    updatedAt: Date;
    preferences: Array<{ id: string; dimension: string; value: string; source: string }>;
    signals: Array<{
      id: string;
      kind: string;
      origin: string;
      payload: Prisma.JsonValue;
      recordedAt: Date;
    }>;
  }): TasteProfileView {
    return {
      id: row.id,
      userId: row.userId,
      notes: row.notes,
      preferences: row.preferences.map((item) => this.toPreferenceView(item)),
      signals: row.signals.map((item) => this.toSignalView(item)),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private assertOwner(actorId: string, subjectUserId: string) {
    if (actorId !== subjectUserId) {
      throw AppError.forbidden("Taste data belongs to that subscriber.");
    }
  }

  async ensureProfile(userId: string) {
    return prisma.tasteProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async getForUser(actorId: string, subjectUserId: string): Promise<TasteProfileView> {
    this.assertOwner(actorId, subjectUserId);
    await this.ensureProfile(subjectUserId);
    const row = await prisma.tasteProfile.findUniqueOrThrow({
      where: { userId: subjectUserId },
      include: {
        preferences: { orderBy: { createdAt: "asc" } },
        signals: { orderBy: { recordedAt: "desc" }, take: 50 },
      },
    });
    return this.toProfileView(row);
  }

  async replacePreferences(
    actorId: string,
    subjectUserId: string,
    input: {
      notes?: string | null;
      preferences: Array<{ dimension: string; value: string }>;
    },
  ) {
    this.assertOwner(actorId, subjectUserId);
    const profile = await this.ensureProfile(subjectUserId);
    const cleaned = input.preferences
      .map((item) => ({
        dimension: item.dimension.trim(),
        value: item.value.trim(),
      }))
      .filter((item) => item.dimension && item.value);

    if (cleaned.some((item) => item.dimension.length > 64 || item.value.length > 240)) {
      throw AppError.validation("Taste dimensions and values must stay short.");
    }

    await prisma.$transaction([
      prisma.tastePreference.deleteMany({ where: { profileId: profile.id } }),
      prisma.tasteProfile.update({
        where: { id: profile.id },
        data: { notes: input.notes?.trim() || null },
      }),
      ...cleaned.map((item) =>
        prisma.tastePreference.create({
          data: {
            profileId: profile.id,
            dimension: item.dimension,
            value: item.value,
            source: TasteOrigin.EXPLICIT,
          },
        }),
      ),
    ]);

    logger.info("taste.updated", { userId: subjectUserId, preferenceCount: cleaned.length });
    return this.getForUser(actorId, subjectUserId);
  }

  async recordSignal(
    actorId: string,
    subjectUserId: string,
    input: {
      kind: string;
      origin: TasteOriginValue;
      payload?: Record<string, unknown> | null;
    },
  ) {
    this.assertOwner(actorId, subjectUserId);
    if (!input.kind.trim() || input.kind.length > 64) {
      throw AppError.validation("A taste signal needs a kind.");
    }
    if (input.origin !== TasteOrigin.EXPLICIT && input.origin !== TasteOrigin.INFERRED) {
      throw AppError.validation("Taste signals must be EXPLICIT or INFERRED.");
    }
    const profile = await this.ensureProfile(subjectUserId);
    const row = await prisma.tasteSignal.create({
      data: {
        profileId: profile.id,
        kind: input.kind,
        origin: input.origin,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    logger.info("taste.signal", {
      userId: subjectUserId,
      kind: input.kind,
      origin: input.origin,
    });
    return this.toSignalView(row);
  }

  async getSponsorshipPreferences(actorId: string, subjectUserId: string) {
    this.assertOwner(actorId, subjectUserId);
    const row = await prisma.userSponsorshipPreference.upsert({
      where: { userId: subjectUserId },
      create: { userId: subjectUserId },
      update: {},
    });
    return this.toSponsorshipView(row);
  }

  async updateSponsorshipPreferences(
    actorId: string,
    subjectUserId: string,
    input: Partial<SponsorshipPreferenceView>,
  ) {
    this.assertOwner(actorId, subjectUserId);
    const row = await prisma.userSponsorshipPreference.upsert({
      where: { userId: subjectUserId },
      create: {
        userId: subjectUserId,
        allowSponsorCredits: input.allowSponsorCredits ?? false,
        allowSponsoredEndCard: input.allowSponsoredEndCard ?? false,
        allowVideoAds: input.allowVideoAds ?? false,
        allowPersonalizedSponsoring: input.allowPersonalizedSponsoring ?? false,
      },
      update: {
        ...(input.allowSponsorCredits === undefined
          ? {}
          : { allowSponsorCredits: input.allowSponsorCredits }),
        ...(input.allowSponsoredEndCard === undefined
          ? {}
          : { allowSponsoredEndCard: input.allowSponsoredEndCard }),
        ...(input.allowVideoAds === undefined ? {} : { allowVideoAds: input.allowVideoAds }),
        ...(input.allowPersonalizedSponsoring === undefined
          ? {}
          : { allowPersonalizedSponsoring: input.allowPersonalizedSponsoring }),
      },
    });
    logger.info("sponsorship.preferences_updated", { userId: subjectUserId });
    return this.toSponsorshipView(row);
  }

  toSponsorshipView(row: {
    allowSponsorCredits: boolean;
    allowSponsoredEndCard: boolean;
    allowVideoAds: boolean;
    allowPersonalizedSponsoring: boolean;
  }): SponsorshipPreferenceView {
    return {
      allowSponsorCredits: row.allowSponsorCredits,
      allowSponsoredEndCard: row.allowSponsoredEndCard,
      allowVideoAds: row.allowVideoAds,
      allowPersonalizedSponsoring: row.allowPersonalizedSponsoring,
    };
  }

  hintForCapability(profile: TasteProfileView, capability: string) {
    return tasteHintForCapability(profile, capability);
  }

  suggestedDimensions() {
    return [...preferenceSchemaKeys];
  }
}
