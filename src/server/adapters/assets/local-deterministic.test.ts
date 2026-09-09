import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpAssetGeneratorAdapter } from "@/server/adapters/assets/http-asset";
import { LocalDeterministicAssetGenerator } from "@/server/adapters/assets/local-deterministic";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { fingerprintAssetGeneratorInput } from "@/server/assets/fingerprint";
import type { AssetGeneratorInput } from "@/server/assets/input";
import { GENERATED_ASSET_KINDS } from "@/server/assets/kinds";
import { GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION } from "@/server/assets/schema";
import { validateGeneratedAssetDocument } from "@/server/assets/validate";
import { AssetCapability } from "@/server/ports/capabilities";

function baseInput(overrides: Partial<AssetGeneratorInput> = {}): AssetGeneratorInput {
  return {
    projectId: "proj_1",
    kind: "IMAGE",
    role: "intimate_portrait",
    storySceneId: "scene-arrive",
    creativeHints: { scenePurpose: "Hold on a face." },
    projectIntent: {
      projectId: "proj_1",
      purpose: "Birthday weekend",
      audience: "family",
      mood: "joyful",
      desiredDurationMs: 120_000,
      narrativeStyle: "documentary",
      visualStyle: "handheld warmth",
      musicStyle: "acoustic",
      explicitInstructions: "Keep it short",
      extras: null,
    },
    effectiveBrief: {
      purpose: "Birthday weekend",
      audience: "family",
      mood: "joyful",
      narrativeStyle: "documentary",
      visualStyle: "handheld warmth",
      musicStyle: "acoustic",
      desiredDurationMs: 120_000,
      pacing: null,
      whatMatters: [],
      explicitInstructions: "Keep it short",
      overriddenByProject: [],
    },
    timelineId: "tl_1",
    timelineVersion: 1,
    storyStructureId: "story_1",
    storyStructureVersion: 2,
    ...overrides,
  };
}

describe("LocalDeterministicAssetGenerator", () => {
  let dir = "";
  let storage: LocalStorageAdapter;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-asset-local-"));
    storage = new LocalStorageAdapter(dir);
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes placeholder bytes for every locked kind and is never production", async () => {
    const generator = new LocalDeterministicAssetGenerator(storage);
    expect(generator.production).toBe(false);
    for (const kind of GENERATED_ASSET_KINDS) {
      const document = await generator.generate(
        baseInput({
          kind,
          role: kind === "ENHANCEMENT" ? "enhance_still" : "intimate_portrait",
          sourceMediaAssetId: kind === "ENHANCEMENT" ? "media_1" : undefined,
        }),
      );
      expect(document.schemaVersion).toBe(GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION);
      expect(document.kind).toBe(kind);
      expect(document.storageKey).not.toMatch(/^https?:\/\//);
      expect(await storage.exists(document.storageKey)).toBe(true);
      expect(() => validateGeneratedAssetDocument(document)).not.toThrow();
    }
    const attribution = generator.executionAttribution(AssetCapability.IMAGE_GENERATION);
    expect(attribution.providerKey).toBe("youflicks.local.asset");
    expect(attribution.capability).toBe(AssetCapability.IMAGE_GENERATION);
  });
});

describe("HttpAssetGeneratorAdapter", () => {
  it("is unconfigured without credentials and fails honestly", async () => {
    const storage = new LocalStorageAdapter("/tmp/youflicks-unused-asset-http");
    const adapter = new HttpAssetGeneratorAdapter(storage, {
      providerKey: "http.asset",
    });
    expect(adapter.configured).toBe(false);
    expect(adapter.production).toBe(true);
    await expect(adapter.generate(baseInput())).rejects.toMatchObject({
      code: "ASSET_PROVIDER_UNAVAILABLE",
    });
  });
});

describe("fingerprintAssetGeneratorInput", () => {
  it("is order-independent for object keys", () => {
    const a = baseInput();
    const hashA = fingerprintAssetGeneratorInput(a);
    const hashB = fingerprintAssetGeneratorInput({
      ...a,
      effectiveBrief: {
        overriddenByProject: [],
        whatMatters: [],
        pacing: null,
        explicitInstructions: "Keep it short",
        desiredDurationMs: 120_000,
        musicStyle: "acoustic",
        visualStyle: "handheld warmth",
        narrativeStyle: "documentary",
        mood: "joyful",
        audience: "family",
        purpose: "Birthday weekend",
      },
    });
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });
});
