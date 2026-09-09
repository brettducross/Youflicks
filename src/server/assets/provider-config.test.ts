import { describe, expect, it } from "vitest";
import {
  isLocalAssetGeneratorAllowed,
  parseAssetHttpCapabilities,
} from "@/server/assets/provider-config";
import { AssetCapability } from "@/server/ports/capabilities";

describe("isLocalAssetGeneratorAllowed", () => {
  it("allows explicit local asset generation outside production", () => {
    expect(isLocalAssetGeneratorAllowed("development", true)).toBe(true);
    expect(isLocalAssetGeneratorAllowed("test", true)).toBe(true);
  });

  it("never enables local asset generation in production", () => {
    expect(isLocalAssetGeneratorAllowed("production", true)).toBe(false);
    expect(isLocalAssetGeneratorAllowed("production", false)).toBe(false);
  });

  it("requires explicit opt-in even in development", () => {
    expect(isLocalAssetGeneratorAllowed("development", false)).toBe(false);
  });
});

describe("parseAssetHttpCapabilities", () => {
  it("accepts YouFlicks capability strings only", () => {
    expect(parseAssetHttpCapabilities("IMAGE_GENERATION,VOICE_SYNTHESIS")).toEqual([
      AssetCapability.IMAGE_GENERATION,
      AssetCapability.VOICE_SYNTHESIS,
    ]);
    expect(parseAssetHttpCapabilities("openai,stable-diffusion")).toBeUndefined();
  });
});
