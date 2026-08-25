import type { CapabilityValue } from "@/server/ports/capabilities";
import type { AnalyzeMediaInput } from "@/server/ports/media-analyzer";

/**
 * What an adapter may return before normalization.
 * This is not a vendor SDK type. Unknown keys are allowed so a future
 * adapter can pass extra observations; the normalizer keeps only the
 * YouFlicks-owned contract (plus passthrough extras that validate).
 */
export type AdapterObservation = Record<string, unknown>;

export type AdapterAnalyzeResult = {
  providerKey: string;
  modelId?: string | null;
  modelVersion?: string | null;
  observations: AdapterObservation;
};

/**
 * Hints a future router may use. Phase 2B does not rank or route on these.
 */
export type AdapterRoutingHints = {
  quality?: number;
  cost?: number;
  latency?: number;
  reliability?: number;
  qualityTier?: "low" | "standard" | "high";
  estimatedCost?: number;
  estimatedLatency?: number;
};

export type AdapterHealth = {
  providerKey: string;
  configured: boolean;
  enabled: boolean;
  available: boolean;
  capabilities: readonly CapabilityValue[];
  routing?: AdapterRoutingHints;
};

/**
 * Provider adapter contract. Implementations live under src/server/adapters.
 * The filmmaking core never imports a concrete adapter class.
 */
export interface MediaAnalysisAdapter {
  readonly providerKey: string;
  readonly capabilities: readonly CapabilityValue[];
  readonly routing?: AdapterRoutingHints;
  readonly configured: boolean;
  readonly enabled: boolean;
  analyze(input: AnalyzeMediaInput): Promise<AdapterAnalyzeResult>;
  health(): AdapterHealth;
}
