import { describe, expect, it } from "vitest";
import { LocalTechnicalAnalyzer } from "@/server/adapters/analysis/local-technical";
import { AnalysisCapability } from "@/server/ports/capabilities";

describe("LocalTechnicalAnalyzer", () => {
  const adapter = new LocalTechnicalAnalyzer();

  it("is always configured and advertises image and video analysis", () => {
    expect(adapter.providerKey).toBe("youflicks.local.technical");
    expect(adapter.configured).toBe(true);
    expect(adapter.enabled).toBe(true);
    expect(adapter.capabilities).toEqual([
      AnalysisCapability.IMAGE_ANALYSIS,
      AnalysisCapability.VIDEO_ANALYSIS,
    ]);
    expect(adapter.health().available).toBe(true);
  });

  it("copies known ingest metadata and invents no visual notes", async () => {
    const result = await adapter.analyze({
      assetId: "a1",
      projectId: "p1",
      storageKey: "projects/p1/a1",
      kind: "PHOTO",
      mimeType: "image/png",
      filename: "still.png",
      byteSize: 128,
      width: 800,
      height: 600,
      durationMs: null,
      checksum: "abc",
      previewStorageKey: null,
      requestedCapabilities: [AnalysisCapability.IMAGE_ANALYSIS],
    });
    expect(result.providerKey).toBe("youflicks.local.technical");
    expect(result.observations.technical).toMatchObject({
      mimeType: "image/png",
      width: 800,
      height: 600,
      orientation: "landscape",
    });
    expect(result.observations.visual).toBeUndefined();
    expect(result.observations.people).toBeUndefined();
  });
});
