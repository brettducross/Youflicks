import { describe, expect, it } from "vitest";
import {
  capabilityForGenerateKind,
  yfGenerateRequestSchema,
  yfGenerateSuccessSchema,
} from "@/server/gateways/yf-asset/contract";
import { AssetCapability } from "@/server/ports/capabilities";

describe("YouFlicks /v1/generate contract", () => {
  it("accepts the body HttpAssetGeneratorAdapter already sends", () => {
    const parsed = yfGenerateRequestSchema.safeParse({
      model: "research.ltx",
      kind: "VIDEO_CLIP",
      role: "broll_sunrise",
      input: {
        projectId: "proj_1",
        kind: "VIDEO_CLIP",
        role: "broll_sunrise",
        creativeHints: { scenePurpose: "Hold on the porch." },
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(capabilityForGenerateKind(parsed.data.kind)).toBe(AssetCapability.VIDEO_GENERATION);
    }
  });

  it("rejects unknown kinds instead of inventing vendor types", () => {
    expect(yfGenerateRequestSchema.safeParse({ kind: "KLING_SHOT", role: "x" }).success).toBe(
      false,
    );
  });

  it("maps unmet audio kinds honestly so the gateway can refuse them", () => {
    expect(capabilityForGenerateKind("VOICE_OVER")).toBe(AssetCapability.VOICE_SYNTHESIS);
    expect(capabilityForGenerateKind("MUSIC")).toBe(AssetCapability.MUSIC_GENERATION);
    expect(capabilityForGenerateKind("SFX")).toBe(AssetCapability.SFX_GENERATION);
  });

  it("keeps the success payload bytes + YouFlicks job id — no vendor JSON", () => {
    const parsed = yfGenerateSuccessSchema.safeParse({
      mimeType: "video/mp4",
      bytesBase64: "Zg==",
      durationMs: 1000,
      width: 2,
      height: 2,
      jobId: "yf_asset_1",
      falRequest: { id: "nope" },
    });
    expect(parsed.success).toBe(false);
  });
});
