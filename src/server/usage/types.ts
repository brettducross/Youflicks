/**
 * M8.3 usage + engine-cost types. Platform/ops only — never written into
 * CreativePlan, Story, or Timeline JSON.
 */

export const UsageKind = {
  MOVIE_GENERATION: "MOVIE_GENERATION",
  RENDER_SECONDS: "RENDER_SECONDS",
  ASSET_CALL: "ASSET_CALL",
} as const;

export type UsageKindValue = (typeof UsageKind)[keyof typeof UsageKind];

export const UsageOutcome = {
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
} as const;

export type UsageOutcomeValue = (typeof UsageOutcome)[keyof typeof UsageOutcome];

export const EngineCostKind = {
  ESTIMATED: "ESTIMATED",
  ACTUAL: "ACTUAL",
} as const;

export type EngineCostKindValue = (typeof EngineCostKind)[keyof typeof EngineCostKind];

export type EngineCostInput = {
  providerKey: string;
  capability: string;
  costUnits: number;
  costKind?: string;
  jobId?: string | null;
};

export type RecordUsageInput = {
  userId: string;
  projectId?: string | null;
  jobId?: string | null;
  /** Open string: MOVIE_GENERATION | RENDER_SECONDS | ASSET_CALL | … */
  kind: string;
  quantity: number;
  outcome?: string;
  recordedAt?: Date;
  engineCost?: EngineCostInput;
};

export type RecordJobUsageInput = {
  userId: string;
  projectId?: string | null;
  jobId?: string | null;
  kind: string;
  quantity: number;
  outcome?: string;
  providerKey: string;
  capability: string;
  costKind?: string;
};

export type EngineCostEventView = {
  id: string;
  usageEventId: string;
  jobId: string | null;
  providerKey: string;
  capability: string;
  costUnits: number;
  costKind: string;
  recordedAt: string;
};

export type UsageEventView = {
  id: string;
  userId: string;
  projectId: string | null;
  jobId: string | null;
  kind: string;
  quantity: number;
  outcome: string;
  recordedAt: string;
  engineCosts: EngineCostEventView[];
};

export type UsageQuery = {
  kind?: string;
  since?: Date;
  jobId?: string;
};
