/**
 * M8.2 entitlement types. Platform-only — never written into CreativePlan.
 */

export const EntitlementDenyCode = {
  EMAIL_UNVERIFIED: "EMAIL_UNVERIFIED",
  RATE_LIMITED: "RATE_LIMITED",
  DURATION_EXCEEDS_PLAN: "DURATION_EXCEEDS_PLAN",
  SUSPENDED: "SUSPENDED",
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
} as const;

export type EntitlementDenyCodeValue =
  (typeof EntitlementDenyCode)[keyof typeof EntitlementDenyCode];

export const PlanKind = {
  FREE: "FREE",
  SUBSCRIPTION: "SUBSCRIPTION",
  PREPAID: "PREPAID",
  HYBRID: "HYBRID",
} as const;

export type PlanKindValue = (typeof PlanKind)[keyof typeof PlanKind];

export const MeterKind = {
  MOVIE_GENERATION: "MOVIE_GENERATION",
} as const;

export type MeterKindValue = (typeof MeterKind)[keyof typeof MeterKind];

export const ENTITLEMENT_SNAPSHOT_SCHEMA_VERSION = "1.0" as const;

export const FREE_MOVIE_GENERATIONS_PER_HOUR = 1;
export const FREE_MAX_OUTPUT_DURATION_MS = 300_000;
export const MOVIE_GENERATION_WINDOW_MS = 60 * 60 * 1000;

export type EntitlementSnapshot = {
  schemaVersion: typeof ENTITLEMENT_SNAPSHOT_SCHEMA_VERSION;
  userId: string;
  planKind: PlanKindValue;
  movieGenerationsPerHour: number;
  maxOutputDurationMs: number;
  watermarkRequired: boolean;
  adsEnabled: boolean;
  resolvedAt: string;
};

export type GenerationConstraints = {
  maxOutputDurationMs: number;
  watermarkRequired: boolean;
  adsEnabled: boolean;
};

/** Platform receipt from ALLOW. Not a CreativePlan / Story / Timeline field. */
export type GenerationConstraintReceipt = GenerationConstraints & {
  userId: string;
  projectId: string | null;
  recordedAt: string;
};

export type RemainingQuota = {
  kind: typeof MeterKind.MOVIE_GENERATION;
  remaining: number;
  limit: number;
  windowMs: number;
  windowResetsAt: string | null;
};

export type AuthorizeGenerationIntent = {
  requestedMaxDurationMs?: number;
  projectId?: string;
};

export type AuthorizeGenerationAllow = {
  allowed: true;
  snapshot: EntitlementSnapshot;
  remainingQuota: RemainingQuota;
  constraints: GenerationConstraints;
};

export type AuthorizeGenerationDeny = {
  allowed: false;
  code: EntitlementDenyCodeValue;
  message: string;
};

export type AuthorizeGenerationResult = AuthorizeGenerationAllow | AuthorizeGenerationDeny;

export type PlatformGate = {
  userId: string;
  emailVerified: boolean;
  canGenerate: boolean;
  denyCode: EntitlementDenyCodeValue | null;
};

/** Account / chrome honesty. Not a CreativePlan and not a billing catalog. */
export type EntitlementSummary = {
  watermarkRequired: boolean;
  adsEnabled: boolean;
  maxOutputDurationMs: number;
  remainingMovieGenerations: number;
};

export type SubscriptionGrant = {
  planKey: string;
  movieGenerationsPerHour?: number;
  maxOutputDurationMs?: number;
  watermarkRequired?: boolean;
  adsEnabled?: boolean;
};

export type PrepaidGrant = {
  remainingCredits: number;
  movieGenerationsPerHour?: number;
  maxOutputDurationMs?: number;
  watermarkRequired?: boolean;
  adsEnabled?: boolean;
};
