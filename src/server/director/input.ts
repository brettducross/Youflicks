import type { CapabilityValue } from "@/server/ports/capabilities";
import type { CreativeIntentView, EffectiveCreativeBrief } from "@/server/personalization/views";
import type { DirectorDecision } from "@/server/director/schema";

/**
 * Minimized taste the Director may see. No user id, notes, or signal payloads.
 * Explicit preferences and inferred signal summaries stay distinct.
 */
export type DirectorTasteBrief = {
  explicitPreferences: Array<{ dimension: string; value: string }>;
  inferredSignalSummary: Array<{ kind: string; count: number }>;
  ignoreGeneralTaste: boolean;
};

export type DirectorMediaItem = {
  assetId: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  analysisStatus: string;
};

export type DirectorMediaUnderstanding = {
  assetId: string;
  kind: string;
  analysis: Record<string, unknown> | null;
};

export type DirectorCapabilityAvailability = {
  capability: CapabilityValue;
  available: boolean;
};

export type DirectorConstraints = {
  desiredDurationMs: number | null;
  explicitInstructions: string | null;
  ignoreGeneralTaste: boolean;
};

/**
 * Provider-neutral Director input. YouFlicks-owned only.
 * No vendor JSON, credentials, sponsor records, or user identity.
 */
export type DirectorInput = {
  projectId: string;
  tasteBrief: DirectorTasteBrief;
  projectIntent: CreativeIntentView;
  effectiveBrief: EffectiveCreativeBrief;
  mediaInventory: DirectorMediaItem[];
  mediaUnderstanding: DirectorMediaUnderstanding[];
  constraints: DirectorConstraints;
  availableCapabilities: CapabilityValue[];
  capabilityAvailability: DirectorCapabilityAvailability[];
  priorDecisions: DirectorDecision[];
};
