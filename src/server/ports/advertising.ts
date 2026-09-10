import type {
  AdvertisingContext,
  AdvertisingEvent,
  AdvertisingOpsQuery,
  AdvertisingSurfaceView,
  AdsHonesty,
} from "@/server/advertising/types";

/**
 * Commercial campaign / serve surfaces. Not creative intelligence.
 * Must not call AiDirectorPort or write CreativePlan.
 * May read EntitlementSnapshot + UserSponsorshipPreference.
 */
export type AdvertisingPort = {
  eligibleSurfaces(
    userId: string,
    context?: AdvertisingContext,
  ): Promise<AdvertisingSurfaceView[]>;
  recordImpression(userId: string, surfaceKey: string): Promise<void>;
  recordClick(userId: string, surfaceKey: string): Promise<void>;
  adsHonesty(userId: string): Promise<AdsHonesty>;
  listEvents(query?: AdvertisingOpsQuery): Promise<AdvertisingEvent[]>;
};
