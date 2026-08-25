import { AppError } from "@/lib/errors";
import { ProviderRegistry } from "@/server/analysis/registry";
import {
  PreferredThenFirstPolicy,
  type ProviderSelectionPolicy,
} from "@/server/analysis/selection";
import type { CapabilityValue } from "@/server/ports/capabilities";
import type { DirectorCapabilityAvailability } from "@/server/director/input";

/**
 * How the Director asks for work. Selection stays in the registry/policy.
 * The return value never includes providerKey so the Director cannot
 * branch on a vendor name.
 */
export class DirectorCapabilityGateway {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly policy: ProviderSelectionPolicy = new PreferredThenFirstPolicy(),
  ) {}

  availability(): DirectorCapabilityAvailability[] {
    const seen = new Set<CapabilityValue>();
    for (const adapter of this.registry.list()) {
      for (const capability of adapter.capabilities) {
        seen.add(capability);
      }
    }
    return [...seen].map((capability) => ({
      capability,
      available: this.isAvailable(capability),
    }));
  }

  advertised(): CapabilityValue[] {
    return this.availability().map((item) => item.capability);
  }

  isAvailable(capability: CapabilityValue) {
    return Boolean(
      this.policy.select(this.registry.list(), {
        capability,
        mediaKind: "ANY",
      }),
    );
  }

  /**
   * Require a capability. Throws rather than inventing a result.
   * Does not return which adapter was chosen.
   */
  require(capability: CapabilityValue) {
    if (!this.isAvailable(capability)) {
      throw AppError.directorCapabilityUnavailable(capability);
    }
    return { capability, available: true as const };
  }
}
