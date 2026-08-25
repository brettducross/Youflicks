/**
 * Taste, intent, credits, and sponsorship constants.
 * These are YouFlicks-owned string keys — not Prisma enums, not vendor names.
 */

export const TasteOrigin = {
  EXPLICIT: "EXPLICIT",
  INFERRED: "INFERRED",
} as const;

export type TasteOriginValue = (typeof TasteOrigin)[keyof typeof TasteOrigin];

export const TasteSignalKind = {
  USER_SELECTED_MOVIE: "USER_SELECTED_MOVIE",
  USER_SELECTED_STYLE: "USER_SELECTED_STYLE",
  USER_RATED_FILM: "USER_RATED_FILM",
  USER_CHANGED_EDIT: "USER_CHANGED_EDIT",
  USER_REJECTED_SUGGESTION: "USER_REJECTED_SUGGESTION",
  USER_ACCEPTED_SUGGESTION: "USER_ACCEPTED_SUGGESTION",
} as const;

export type TasteSignalKindValue = (typeof TasteSignalKind)[keyof typeof TasteSignalKind];

/** Suggested dimensions. Additional keys are allowed. */
export const TasteDimension = {
  FAVORITE_FILMS: "favorite_films",
  FAVORITE_DIRECTORS: "favorite_directors",
  GENRES: "genres",
  PACING: "pacing",
  VISUAL_STYLE: "visual_style",
  EDITING_STYLE: "editing_style",
  MUSIC_STYLE: "music_style",
  EMOTIONAL: "emotional",
  NARRATIVE: "narrative",
  WHAT_MATTERS: "what_matters",
} as const;

export const CreditType = {
  YOUFLICKS: "YOUFLICKS",
  ANALYSIS_PROVIDER: "ANALYSIS_PROVIDER",
  TRANSCRIPTION_PROVIDER: "TRANSCRIPTION_PROVIDER",
  MUSIC_PROVIDER: "MUSIC_PROVIDER",
  VOICE_PROVIDER: "VOICE_PROVIDER",
  RENDER_PROVIDER: "RENDER_PROVIDER",
  SPONSOR: "SPONSOR",
  CAMPAIGN: "CAMPAIGN",
} as const;

export type CreditTypeValue = (typeof CreditType)[keyof typeof CreditType];

export const SponsorPlacementKind = {
  CREDIT_ONLY: "CREDIT_ONLY",
  LOGO: "LOGO",
  FEATURED_LOGO: "FEATURED_LOGO",
  ANIMATED_CREDIT: "ANIMATED_CREDIT",
  SPONSORED_END_CARD: "SPONSORED_END_CARD",
  AUDIO_MESSAGE: "AUDIO_MESSAGE",
  VIDEO_ADVERTISEMENT: "VIDEO_ADVERTISEMENT",
} as const;

export const PlacementStatus = {
  ELIGIBLE: "ELIGIBLE",
  APPROVED: "APPROVED",
  DECLINED: "DECLINED",
  APPLIED: "APPLIED",
} as const;

export const WHAT_MATTERS_OPTIONS = [
  "Emotion",
  "Humor",
  "Story",
  "Action",
  "Cinematic visuals",
  "Music",
  "Realism",
] as const;
