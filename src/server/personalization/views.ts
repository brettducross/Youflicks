import type { TasteOriginValue } from "@/server/domain/personalization";

export type TastePreferenceView = {
  id: string;
  dimension: string;
  value: string;
  source: TasteOriginValue;
};

export type TasteSignalView = {
  id: string;
  kind: string;
  origin: TasteOriginValue;
  payload: Record<string, unknown> | null;
  recordedAt: string;
};

export type TasteProfileView = {
  id: string;
  userId: string;
  notes: string | null;
  preferences: TastePreferenceView[];
  signals: TasteSignalView[];
  updatedAt: string;
};

export type SponsorshipPreferenceView = {
  allowSponsorCredits: boolean;
  allowSponsoredEndCard: boolean;
  allowVideoAds: boolean;
  allowPersonalizedSponsoring: boolean;
};

export type CreativeIntentView = {
  projectId: string;
  purpose: string | null;
  audience: string | null;
  mood: string | null;
  desiredDurationMs: number | null;
  narrativeStyle: string | null;
  visualStyle: string | null;
  musicStyle: string | null;
  explicitInstructions: string | null;
  extras: Record<string, unknown> | null;
};

export type EffectiveCreativeBrief = {
  purpose: string | null;
  audience: string | null;
  mood: string | null;
  desiredDurationMs: number | null;
  narrativeStyle: string | null;
  visualStyle: string | null;
  musicStyle: string | null;
  pacing: string | null;
  whatMatters: string[];
  explicitInstructions: string | null;
  overriddenByProject: string[];
};

export type ProviderAttributionView = {
  id: string;
  projectId: string;
  assetId: string | null;
  generatedAssetId: string | null;
  analysisId: string | null;
  jobId: string | null;
  providerKey: string;
  capability: string;
  modelId: string | null;
  modelVersion: string | null;
  recordedAt: string;
};

export type FilmCreditLineView = {
  id: string;
  displayName: string;
  providerKey: string | null;
  creditType: string;
  displayOrder: number;
  logoKey: string | null;
  audioKey: string | null;
  videoKey: string | null;
  linkUrl: string | null;
};

export type FilmCreditsView = {
  id: string;
  projectId: string;
  movieId: string | null;
  status: string;
  lines: FilmCreditLineView[];
  createdAt: string;
};
