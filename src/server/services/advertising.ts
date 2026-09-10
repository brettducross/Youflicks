import "server-only";

import { logger } from "@/lib/logger";
import {
  CommercialPlacement,
  CommercialSurface,
  FREE_TIER_ADS_HONESTY,
  IN_MOVIE_SURFACE,
  type AdsHonesty,
  type AdvertisingContext,
  type AdvertisingEvent,
  type AdvertisingSurfaceView,
} from "@/server/advertising/types";
import type { EntitlementSnapshot } from "@/server/entitlement/types";
import type { AdvertisingPort } from "@/server/ports/advertising";
import { EntitlementService } from "@/server/services/entitlement";
import { TasteService } from "@/server/services/taste";

const STUB_COPY =
  "Free YouFlicks includes advertising. This notice sits on the app shell — it is not part of your movie.";

const REQUIRED_SURFACES: AdvertisingSurfaceView[] = [
  {
    key: CommercialSurface.UI_SHELL,
    placement: CommercialPlacement.SHELL,
    kind: "STUB",
    copy: STUB_COPY,
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
 * M8.4 AdvertisingPort stub. Serves UI shell / post-film / library chrome only.
 * No ad-network SDK. Prefs cannot hard opt-out when adsEnabled (Constitution §5A + §H5).
 */
export class AdvertisingService implements AdvertisingPort {
  private readonly events: AdvertisingEvent[] = [];

  constructor(
    private readonly entitlements: EntitlementService = new EntitlementService(),
    private readonly taste: TasteService = new TasteService(),
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
    // Phase 2D prefs are read for honesty / future extras — they cannot remove required surfaces.
    await this.taste.getSponsorshipPreferences(userId, userId).catch(() => null);
    const surfaces = REQUIRED_SURFACES;
    if (context.surface) {
      return surfaces.filter((surface) => surface.key === context.surface);
    }
    return surfaces;
  }

  async recordImpression(userId: string, surfaceKey: string) {
    this.record(userId, surfaceKey, "impression");
  }

  async recordClick(userId: string, surfaceKey: string) {
    this.record(userId, surfaceKey, "click");
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

  listEvents() {
    return [...this.events];
  }

  private record(userId: string, surfaceKey: string, kind: AdvertisingEvent["kind"]) {
    if (surfaceKey === IN_MOVIE_SURFACE) {
      return;
    }
    const event: AdvertisingEvent = {
      userId,
      surface: surfaceKey,
      kind,
      at: new Date().toISOString(),
    };
    this.events.push(event);
    logger.info("advertising.event", { userId, surface: surfaceKey, kind, stub: true });
  }
}
