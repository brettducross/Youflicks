import type { CapabilityValue } from "@/server/ports/capabilities";
import type { MediaAnalysisAdapter } from "@/server/ports/media-analysis-adapter";

/**
 * In-process registry of analysis adapters.
 * Multiple adapters may advertise the same capability.
 * Phase 2B does not rank or route; callers receive the registration list.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, MediaAnalysisAdapter>();

  register(adapter: MediaAnalysisAdapter) {
    this.adapters.set(adapter.providerKey, adapter);
    return this;
  }

  unregister(providerKey: string) {
    this.adapters.delete(providerKey);
    return this;
  }

  get(providerKey: string) {
    return this.adapters.get(providerKey);
  }

  list() {
    return [...this.adapters.values()];
  }

  listForCapability(capability: CapabilityValue) {
    return this.list().filter((adapter) => adapter.capabilities.includes(capability));
  }

  /**
   * First registered adapter for a capability. Not a quality/cost router.
   * Future routing may inspect adapter.routing without changing the Director.
   */
  findForCapability(capability: CapabilityValue) {
    return this.listForCapability(capability)[0] ?? null;
  }
}
