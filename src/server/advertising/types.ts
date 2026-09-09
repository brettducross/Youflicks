/**
 * M8.4 commercial advertising surfaces. Outside movie essence.
 * Never an in-movie Timeline clip or CreativePlan beat.
 */

export const CommercialSurface = {
  UI_SHELL: "UI_SHELL",
  POST_FILM: "POST_FILM",
  LIBRARY_BANNER: "LIBRARY_BANNER",
} as const;

export type CommercialSurfaceValue =
  (typeof CommercialSurface)[keyof typeof CommercialSurface];

/** Forbidden unless a future PO decision. AdvertisingPort must never serve this. */
export const IN_MOVIE_SURFACE = "IN_MOVIE" as const;

export const CommercialPlacement = {
  SHELL: "SHELL",
  POST_FILM: "POST_FILM",
} as const;

export type CommercialPlacementValue =
  (typeof CommercialPlacement)[keyof typeof CommercialPlacement];

export type AdvertisingContext = {
  surface?: string;
  projectId?: string;
};

export type AdvertisingSurfaceView = {
  key: CommercialSurfaceValue;
  placement: CommercialPlacementValue;
  kind: "STUB";
  copy: string;
};

export type AdvertisingEventKind = "impression" | "click";

export type AdvertisingEvent = {
  userId: string;
  surface: string;
  kind: AdvertisingEventKind;
  at: string;
};

export type AdsHonesty = {
  adsEnabled: boolean;
  adsRequired: boolean;
  preferenceCannotOptOut: boolean;
  message: string;
};

export const FREE_TIER_ADS_HONESTY =
  "Free YouFlicks includes advertising. Taste preferences cannot turn off required free-tier ads.";
