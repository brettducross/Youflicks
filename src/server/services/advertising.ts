import "server-only";

import { logger } from "@/lib/logger";
import { FirstPartySponsorAdapter } from "@/server/adapters/advertising/first-party-sponsor";
import {
  ALLOWED_AD_SURFACES,
  CommercialPlacement,
  CommercialSurface,
  FIRST_PARTY_AD_PROVIDER_KEY,
  FREE_TIER_ADS_HONESTY,
  IN_MOVIE_SURFACE,
  type AdsHonesty,
  type AdvertisingContext,
  type AdvertisingEvent,
  type AdvertisingOpsQuery,
  type AdvertisingSurfaceView,
} from "@/server/advertising/types";
import type { EntitlementSnapshot } from "@/server/entitlement/types";
import { prisma } from "@/server/db";
import type { AdvertisingPort } from "@/server/ports/advertising";
import { EntitlementService } from "@/server/services/entitlement";
import { TasteService } from "@/server/services/taste";

const STUB_SURFACES: AdvertisingSurfaceView[] = [
  {
    key: CommercialSurface.UI_SHELL,
    placement: CommercialPlacement.SHELL,
    kind: "STUB",
    copy: "Free YouFlicks includes advertising. This notice sits on the app shell — it is not part of your movie.",
  },
  {
    key: CommercialSurface.POST_FILM,
    placement: CommercialPlacement.POST_FILM,
    kind: "STUB",
    copy: "Thanks for watching. Free YouFlicks is ad-supported. This card is after the film, not inside it.",
  },
  {
    key: CommercialSurface.LIBRARY_BANNER,
    placement: CommercialPlacement.SHELL,
    kind: "STUB",
    copy: "Your library is ad-supported on the free plan. Ads stay outside the film.",
  },
];

/**
 * AdvertisingPort: first-party serve on allowed surfaces + persisted ops events.
 * Prefs cannot hard opt-out when adsEnabled (Constitution §5A + §H5).
 * IN_MOVIE is always empty.
 */
export class AdvertisingService implements AdvertisingPort {
  constructor(
    private readonly entitlements: EntitlementService = new EntitlementService(),
    private readonly taste: TasteService = new TasteService(),
    private readonly firstParty: FirstPartySponsorAdapter = new FirstPartySponsorAdapter(),
  ) {}

  async eligibleSurfaces(
    userId: string,
    context: AdvertisingContext = {},
  ): Promise<AdvertisingSurfaceView[]> {
    if (context.surface === IN_MOVIE_SURFACE) {
      return [];
    }
    const snapshot = await this.entitlements.resolve(userId);
    if (!snapshot.adsEnabled) {
      return [];
    }
    await this.taste.getSponsorshipPreferences(userId, userId).catch(() => null);

    const surfaces: AdvertisingSurfaceView[] = [];
    for (const stub of STUB_SURFACES) {
      const firstParty = await this.firstParty.fetchCreative(stub.key, {
        projectId: context.projectId,
      });
      surfaces.push(firstParty ?? stub);
    }

    const filmCredits = await this.firstParty.fetchCreative(CommercialSurface.FILM_CREDITS, {
      projectId: context.projectId,
    });
    if (filmCredits) {
      surfaces.push(filmCredits);
    }

    if (context.surface) {
      return surfaces.filter((surface) => surface.key === context.surface);
    }
    return surfaces;
  }

  async recordImpression(userId: string, surfaceKey: string) {
    await this.record(userId, surfaceKey, "impression");
  }

  async recordClick(userId: string, surfaceKey: string) {
    await this.record(userId, surfaceKey, "click");
  }

  async adsHonesty(userId: string): Promise<AdsHonesty> {
    const snapshot = await this.entitlements.resolve(userId);
    return this.honestyFrom(snapshot);
  }

  honestyFrom(snapshot: Pick<EntitlementSnapshot, "adsEnabled">): AdsHonesty {
    if (!snapshot.adsEnabled) {
      return {
        adsEnabled: false,
        adsRequired: false,
        preferenceCannotOptOut: false,
        message: "Advertising is off for this account.",
      };
    }
    return {
      adsEnabled: true,
      adsRequired: true,
      preferenceCannotOptOut: true,
      message: FREE_TIER_ADS_HONESTY,
    };
  }

  async listEvents(query: AdvertisingOpsQuery = {}): Promise<AdvertisingEvent[]> {
    const rows = await prisma.advertisingEvent.findMany({
      where: {
        userId: query.userId,
        surface: query.surface,
        kind: query.kind,
        recordedAt: query.since ? { gte: query.since } : undefined,
      },
      orderBy: { recordedAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      surface: row.surface,
      kind: row.kind as AdvertisingEvent["kind"],
      at: row.recordedAt.toISOString(),
      providerKey: row.providerKey,
      campaignId: row.campaignId,
      offerId: row.offerId,
    }));
  }

  private async record(userId: string, surfaceKey: string, kind: AdvertisingEvent["kind"]) {
    if (surfaceKey === IN_MOVIE_SURFACE) {
      return;
    }
    if (!ALLOWED_AD_SURFACES.includes(surfaceKey as (typeof ALLOWED_AD_SURFACES)[number])) {
      return;
    }
    await prisma.advertisingEvent.create({
      data: {
        userId,
        surface: surfaceKey,
        kind,
        providerKey: FIRST_PARTY_AD_PROVIDER_KEY,
      },
    });
    logger.info("advertising.event", {
      userId,
      surface: surfaceKey,
      kind,
      providerKey: FIRST_PARTY_AD_PROVIDER_KEY,
    });
  }
}
