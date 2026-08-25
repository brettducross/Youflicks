import { describe, expect, it } from "vitest";
import { DirectorCapabilityGateway } from "@/server/director/capabilities";
import { ProviderRegistry } from "@/server/analysis/registry";
import { PreferredThenFirstPolicy } from "@/server/analysis/selection";
import { AnalysisCapability, Capability } from "@/server/ports/capabilities";
import type { MediaAnalysisAdapter } from "@/server/ports/media-analysis-adapter";

function fakeAdapter(
  providerKey: string,
  capabilities: MediaAnalysisAdapter["capabilities"],
): MediaAnalysisAdapter {
  return {
    providerKey,
    capabilities,
    configured: true,
    enabled: true,
    health: () => ({
      providerKey,
      configured: true,
      enabled: true,
      available: true,
      capabilities,
    }),
    analyze: async () => ({ providerKey, observations: {} }),
  };
}

describe("DirectorCapabilityGateway", () => {
  it("asks for a capability and does not return a vendor key", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeAdapter("alpha", [AnalysisCapability.IMAGE_ANALYSIS]));
    registry.register(fakeAdapter("beta", [AnalysisCapability.IMAGE_ANALYSIS]));
    const gateway = new DirectorCapabilityGateway(registry, new PreferredThenFirstPolicy());
    const result = gateway.require(AnalysisCapability.IMAGE_ANALYSIS);
    expect(result).toEqual({ capability: AnalysisCapability.IMAGE_ANALYSIS, available: true });
    expect(JSON.stringify(result)).not.toMatch(/alpha|beta|openai|anthropic|gemini/i);
  });

  it("leaves vendor selection in the policy/registry", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeAdapter("alpha", [AnalysisCapability.VISION]));
    const selected = new PreferredThenFirstPolicy().select(registry.list(), {
      capability: AnalysisCapability.VISION,
      mediaKind: "PHOTO",
    });
    expect(selected?.providerKey).toBe("alpha");
  });

  it("fails cleanly when a Director capability has no adapter", () => {
    const gateway = new DirectorCapabilityGateway(new ProviderRegistry());
    expect(() => gateway.require(Capability.STORY_REASONING)).toThrow(/STORY_REASONING/);
    try {
      gateway.require(Capability.TIMELINE_PLANNING);
    } catch (error) {
      expect(error).toMatchObject({ code: "DIRECTOR_CAPABILITY_UNAVAILABLE" });
    }
  });
});
