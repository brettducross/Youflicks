import { describe, expect, it } from "vitest";
import { PreferredThenFirstPolicy } from "@/server/analysis/selection";
import { AnalysisCapability } from "@/server/ports/capabilities";
import type { MediaAnalysisAdapter } from "@/server/ports/media-analysis-adapter";

function adapter(
  providerKey: string,
  capabilities: MediaAnalysisAdapter["capabilities"],
  flags: { configured?: boolean; enabled?: boolean } = {},
): MediaAnalysisAdapter {
  const configured = flags.configured ?? true;
  const enabled = flags.enabled ?? true;
  return {
    providerKey,
    capabilities,
    configured,
    enabled,
    health: () => ({
      providerKey,
      configured,
      enabled,
      available: configured && enabled,
      capabilities,
    }),
    analyze: async () => ({ providerKey, observations: {} }),
  };
}

describe("PreferredThenFirstPolicy", () => {
  const policy = new PreferredThenFirstPolicy();
  const context = {
    capability: AnalysisCapability.IMAGE_ANALYSIS,
    mediaKind: "PHOTO",
  };

  it("selects the first ready adapter for a capability", () => {
    const selected = policy.select(
      [
        adapter("local", [AnalysisCapability.IMAGE_ANALYSIS]),
        adapter("http.vision", [AnalysisCapability.IMAGE_ANALYSIS, AnalysisCapability.VISION]),
      ],
      context,
    );
    expect(selected?.providerKey).toBe("local");
  });

  it("honors a preferred provider when it is eligible", () => {
    const selected = policy.select(
      [
        adapter("local", [AnalysisCapability.IMAGE_ANALYSIS]),
        adapter("http.vision", [AnalysisCapability.IMAGE_ANALYSIS]),
      ],
      { ...context, preferredProviderKey: "http.vision" },
    );
    expect(selected?.providerKey).toBe("http.vision");
  });

  it("skips a preferred provider that is not configured", () => {
    const selected = policy.select(
      [
        adapter("local", [AnalysisCapability.IMAGE_ANALYSIS]),
        adapter("http.vision", [AnalysisCapability.IMAGE_ANALYSIS], { configured: false, enabled: false }),
      ],
      { ...context, preferredProviderKey: "http.vision" },
    );
    expect(selected?.providerKey).toBe("local");
  });

  it("filters by advertised capability", () => {
    const selected = policy.select(
      [
        adapter("audio.only", [AnalysisCapability.AUDIO_ANALYSIS]),
        adapter("vision", [AnalysisCapability.IMAGE_ANALYSIS]),
      ],
      context,
    );
    expect(selected?.providerKey).toBe("vision");
  });

  it("returns null when no ready adapter matches", () => {
    const selected = policy.select(
      [adapter("http.vision", [AnalysisCapability.IMAGE_ANALYSIS], { configured: false, enabled: false })],
      context,
    );
    expect(selected).toBeNull();
  });
});
