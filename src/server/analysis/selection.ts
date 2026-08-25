import type { CapabilityValue } from "@/server/ports/capabilities";
import type { MediaAnalysisAdapter } from "@/server/ports/media-analysis-adapter";

export type SelectionContext = {
  capability: CapabilityValue;
  mediaKind: string;
  preferredProviderKey?: string | null;
};

/**
 * Replaceable selection policy. Phase 2C is deterministic: preferred key
 * if eligible, otherwise first ready adapter. Later policies may rank
 * quality, cost, latency, privacy, or health without changing the domain.
 */
export interface ProviderSelectionPolicy {
  select(
    candidates: readonly MediaAnalysisAdapter[],
    context: SelectionContext,
  ): MediaAnalysisAdapter | null;
}

export function isAdapterReady(adapter: MediaAnalysisAdapter) {
  return adapter.enabled && adapter.configured;
}

export class PreferredThenFirstPolicy implements ProviderSelectionPolicy {
  select(candidates: readonly MediaAnalysisAdapter[], context: SelectionContext) {
    const eligible = candidates.filter(
      (adapter) =>
        isAdapterReady(adapter) && adapter.capabilities.includes(context.capability),
    );
    if (context.preferredProviderKey) {
      const preferred = eligible.find(
        (adapter) => adapter.providerKey === context.preferredProviderKey,
      );
      if (preferred) {
        return preferred;
      }
    }
    return eligible[0] ?? null;
  }
}
