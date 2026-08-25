import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { ProviderRegistry } from "@/server/analysis/registry";
import { RegistryMediaAnalyzer } from "@/server/analysis/registry-analyzer";
import { AnalysisCapability } from "@/server/ports/capabilities";
import type { MediaAnalysisAdapter } from "@/server/ports/media-analysis-adapter";
import type { AnalyzeMediaInput } from "@/server/ports/media-analyzer";

function fakeAdapter(
  providerKey: string,
  capabilities: MediaAnalysisAdapter["capabilities"],
  options: { enabled?: boolean; configured?: boolean } = {},
): MediaAnalysisAdapter {
  const configured = options.configured ?? true;
  const enabled = options.enabled ?? configured;
  return {
    providerKey,
    capabilities,
    configured,
    enabled,
    health() {
      return {
        providerKey,
        configured,
        enabled,
        available: configured && enabled,
        capabilities,
      };
    },
    async analyze() {
      return {
        providerKey,
        observations: { technical: { mimeType: "image/png" } },
      };
    },
  };
}

const input: AnalyzeMediaInput = {
  assetId: "a1",
  projectId: "p1",
  storageKey: "projects/p1/a1",
  kind: "PHOTO",
  mimeType: "image/png",
  filename: "still.png",
  byteSize: 12,
  width: 1,
  height: 1,
  durationMs: null,
  checksum: null,
  previewStorageKey: null,
  requestedCapabilities: [AnalysisCapability.IMAGE_ANALYSIS],
};

describe("ProviderRegistry", () => {
  it("lets multiple adapters advertise the same capability", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeAdapter("alpha", [AnalysisCapability.IMAGE_ANALYSIS]));
    registry.register(fakeAdapter("beta", [AnalysisCapability.IMAGE_ANALYSIS, AnalysisCapability.VISION]));
    const listed = registry.listForCapability(AnalysisCapability.IMAGE_ANALYSIS).map((item) => item.providerKey);
    expect(listed).toEqual(["alpha", "beta"]);
  });

  it("throws when no provider is registered for the capability", async () => {
    const analyzer = new RegistryMediaAnalyzer(new ProviderRegistry());
    await expect(analyzer.analyze(input)).rejects.toBeInstanceOf(AppError);
    await expect(analyzer.analyze(input)).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("skips a disabled adapter and uses a ready one", async () => {
    const registry = new ProviderRegistry();
    registry.register(
      fakeAdapter("http.vision", [AnalysisCapability.IMAGE_ANALYSIS], {
        configured: false,
        enabled: false,
      }),
    );
    registry.register(fakeAdapter("local", [AnalysisCapability.IMAGE_ANALYSIS]));
    const result = await new RegistryMediaAnalyzer(registry).analyze(input);
    expect(result.provenance.providerKey).toBe("local");
  });

  it("returns a normalized YouFlicks document from the first matching adapter", async () => {
    const registry = new ProviderRegistry();
    registry.register(fakeAdapter("alpha", [AnalysisCapability.IMAGE_ANALYSIS]));
    const result = await new RegistryMediaAnalyzer(registry).analyze(input);
    expect(result.analysis.analysisSchemaVersion).toBe("1.0");
    expect(result.provenance.providerKey).toBe("alpha");
  });

  it("filters adapters by advertised capability", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeAdapter("vision", [AnalysisCapability.IMAGE_ANALYSIS, AnalysisCapability.VISION]));
    registry.register(fakeAdapter("audio", [AnalysisCapability.AUDIO_ANALYSIS, AnalysisCapability.TRANSCRIPTION]));
    expect(registry.listForCapability(AnalysisCapability.TRANSCRIPTION).map((item) => item.providerKey)).toEqual([
      "audio",
    ]);
    expect(registry.listForCapability(AnalysisCapability.EMBEDDINGS)).toEqual([]);
  });

  it("throws for an unsupported capability", async () => {
    const registry = new ProviderRegistry();
    registry.register(fakeAdapter("vision", [AnalysisCapability.IMAGE_ANALYSIS]));
    const analyzer = new RegistryMediaAnalyzer(registry);
    await expect(
      analyzer.analyze({
        ...input,
        kind: "AUDIO",
        requestedCapabilities: [AnalysisCapability.TRANSCRIPTION],
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("honors the preferred provider when that adapter is ready", async () => {
    const registry = new ProviderRegistry();
    registry.register(fakeAdapter("local", [AnalysisCapability.IMAGE_ANALYSIS]));
    registry.register(fakeAdapter("http.vision", [AnalysisCapability.IMAGE_ANALYSIS]));
    const result = await new RegistryMediaAnalyzer(registry, undefined, "http.vision").analyze(input);
    expect(result.provenance.providerKey).toBe("http.vision");
  });
});
