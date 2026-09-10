/**
 * M8.4 commercial advertising surfaces. Outside movie essence.
 * Never an in-movie Timeline clip or CreativePlan beat.
 */

export const CommercialSurface = {
  UI_SHELL: "UI_SHELL",
  POST_FILM: "POST_FILM",
  LIBRARY_BANNER: "LIBRARY_BANNER",
  /** Approved FilmCredits / SponsorPlacement only. Never in-movie. */
  FILM_CREDITS: "FILM_CREDITS",
} as const;

export type CommercialSurfaceValue =
  (typeof CommercialSurface)[keyof typeof CommercialSurface];

/** Forbidden unless a future PO decision. AdvertisingPort must never serve this. */
export const IN_MOVIE_SURFACE = "IN_MOVIE" as const;

export const CommercialPlacement = {
  SHELL: "SHELL",
  POST_FILM: "POST_FILM",
  FILM_CREDITS: "FILM_CREDITS",
} as const;

export type CommercialPlacementValue =
  (typeof CommercialPlacement)[keyof typeof CommercialPlacement];

export type AdvertisingContext = {
  surface?: string;
  projectId?: string;
};

export type AdvertisingCreativeKind = "STUB" | "FIRST_PARTY";

export type AdvertisingSurfaceView = {
  key: CommercialSurfaceValue;
  placement: CommercialPlacementValue;
  kind: AdvertisingCreativeKind;
  copy: string;
  displayName?: string;
  /** Allowlisted https destination only. Invalid values are never served as href. */
  linkUrl?: string | null;
  providerKey?: string;
  campaignId?: string | null;
  offerId?: string | null;
};

export type AdvertisingEventKind = "impression" | "click";

export type AdvertisingEvent = {
  id?: string;
  userId: string;
  surface: string;
  kind: AdvertisingEventKind;
  at: string;
  providerKey?: string;
  campaignId?: string | null;
  offerId?: string | null;
};

export type AdvertisingOpsQuery = {
  userId?: string;
  surface?: string;
  kind?: AdvertisingEventKind;
  since?: Date;
};

export const FIRST_PARTY_AD_PROVIDER_KEY = "youflicks.first_party" as const;

export const ALLOWED_AD_SURFACES: CommercialSurfaceValue[] = [
  CommercialSurface.UI_SHELL,
  CommercialSurface.POST_FILM,
  CommercialSurface.LIBRARY_BANNER,
  CommercialSurface.FILM_CREDITS,
];

export type AdsHonesty = {
  adsEnabled: boolean;
  adsRequired: boolean;
  preferenceCannotOptOut: boolean;
  message: string;
};

export const FREE_TIER_ADS_HONESTY =
  "Free YouFlicks includes advertising. Taste preferences cannot turn off required free-tier ads.";
