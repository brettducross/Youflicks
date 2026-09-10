import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HttpAssetGeneratorAdapter } from "@/server/adapters/assets/http-asset";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import type { AssetGeneratorInput } from "@/server/assets/input";
import { GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION } from "@/server/assets/schema";
import { validateGeneratedAssetDocument } from "@/server/assets/validate";
import { AssetCapability } from "@/server/ports/capabilities";

function baseInput(overrides: Partial<AssetGeneratorInput> = {}): AssetGeneratorInput {
  return {
    projectId: "proj_1",
    kind: "VIDEO_CLIP",
    role: "broll_sunrise",
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

describe("HttpAssetGeneratorAdapter", () => {
  let dir = "";
  let storage: LocalStorageAdapter;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-asset-http-"));
    storage = new LocalStorageAdapter(dir);
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("fails closed without URL, key, and model", async () => {
    const adapter = new HttpAssetGeneratorAdapter(storage, { providerKey: "http.asset" });
    expect(adapter.configured).toBe(false);
    expect(adapter.supportedCapabilities()).toEqual([AssetCapability.VIDEO_GENERATION]);
    await expect(adapter.generate(baseInput())).rejects.toMatchObject({
      code: "ASSET_PROVIDER_UNAVAILABLE",
    });
  });

  it("advertises only configured YouFlicks capabilities and refuses the rest", async () => {
    const adapter = new HttpAssetGeneratorAdapter(storage, {
      providerKey: "research.video",
      baseUrl: "http://127.0.0.1:43148",
      apiKey: "gw-key",
      model: "research.ltx",
      capabilities: [AssetCapability.VIDEO_GENERATION],
    });
    expect(adapter.providerKey).toBe("research.video");
    expect(adapter.supports(AssetCapability.VIDEO_GENERATION)).toBe(true);
    expect(adapter.supports(AssetCapability.VOICE_SYNTHESIS)).toBe(false);
    await expect(adapter.generate(baseInput({ kind: "VOICE_OVER", role: "narration" }))).rejects.toMatchObject({
      code: "ASSET_CAPABILITY_UNAVAILABLE",
    });
  });

  it("maps YouFlicks /v1/generate bytes into StoragePort without a vendor URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:43148/v1/generate");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gw-key");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("research.ltx");
      expect(body.kind).toBe("VIDEO_CLIP");
      expect(body.input.projectId).toBe("proj_1");
      return new Response(
        JSON.stringify({
          mimeType: "video/mp4",
          bytesBase64: Buffer.from("gateway-mp4").toString("base64"),
          durationMs: 1000,
          width: 2,
          height: 2,
          jobId: "yf_asset_contract",
        }),
        { status: 200 },
      );
    });
    const adapter = new HttpAssetGeneratorAdapter(
      storage,
      {
        providerKey: "http.asset",
        baseUrl: "http://127.0.0.1:43148",
        apiKey: "gw-key",
        model: "research.ltx",
      },
      fetchImpl,
    );
    const document = await adapter.generate(baseInput());
    expect(document.schemaVersion).toBe(GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION);
    expect(document.kind).toBe("VIDEO_CLIP");
    expect(document.storageKey).not.toMatch(/^https?:\/\//);
    expect(document).not.toHaveProperty("jobId");
    expect(await storage.exists(document.storageKey)).toBe(true);
    expect(() => validateGeneratedAssetDocument(document)).not.toThrow();
    const stored = await storage.get(document.storageKey);
    expect(Buffer.from(stored!.body).toString("utf8")).toBe("gateway-mp4");
  });

  it("does not leak the API key when the gateway fails", async () => {
    const adapter = new HttpAssetGeneratorAdapter(
      storage,
      {
        providerKey: "http.asset",
        baseUrl: "http://127.0.0.1:43148",
        apiKey: "super-secret-gateway-key",
        model: "research.ltx",
      },
      async () => new Response("unauthorized super-secret-gateway-key", { status: 401 }),
    );
    await expect(adapter.generate(baseInput())).rejects.toMatchObject({
      code: "ASSET_PROVIDER_UNAVAILABLE",
    });
    try {
      await adapter.generate(baseInput());
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-gateway-key");
    }
  });
});
