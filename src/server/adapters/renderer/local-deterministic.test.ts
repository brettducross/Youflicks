import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpRendererAdapter } from "@/server/adapters/renderer/http-renderer";
import { LocalDeterministicRenderer } from "@/server/adapters/renderer/local-deterministic";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { RenderCapability } from "@/server/ports/capabilities";
import { fingerprintRenderComposerInput } from "@/server/render/fingerprint";
import type { RenderComposerInput } from "@/server/render/input";
import { RENDER_MANIFEST_SCHEMA_VERSION } from "@/server/render/schema";
import { validateRenderResultDocument } from "@/server/render/validate";

function baseInput(overrides: Partial<RenderComposerInput> = {}): RenderComposerInput {
  return {
    projectId: "proj_1",
    timelineId: "tl_1",
    timelineVersion: 1,
    outputProfile: "WEB_1080",
    destinationKeyHint: "projects/proj_1/renders/rj_1/output.mp4",
    manifest: {
      schemaVersion: RENDER_MANIFEST_SCHEMA_VERSION,
      timelineId: "tl_1",
      timelineVersion: 1,
      totalDurationMs: 3000,
      outputProfile: "WEB_1080",
      clips: [
        {
          clipId: "clip-1",
          trackKey: "video.primary",
          sourceKind: "MEDIA_ASSET",
          sourceId: "media_1",
          storageKey: "projects/proj_1/media/media_1/original.bin",
          timelineStartMs: 0,
          timelineEndMs: 3000,
        },
      ],
    },
    ...overrides,
  };
}

describe("LocalDeterministicRenderer", () => {
  let dir = "";
  let storage: LocalStorageAdapter;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-render-local-"));
    storage = new LocalStorageAdapter(dir);
    await storage.put({
      key: "projects/proj_1/media/media_1/original.bin",
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: "application/octet-stream",
    });
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("reads StoragePort sources, writes opaque output, and is never production", async () => {
    const renderer = new LocalDeterministicRenderer(storage);
    expect(renderer.production).toBe(false);
    const result = await renderer.render(baseInput());
    expect(result.storageKey).not.toMatch(/^https?:\/\//);
    expect(result.mimeType).toBe("video/mp4");
    expect(await storage.exists(result.storageKey)).toBe(true);
    expect(() => validateRenderResultDocument(result)).not.toThrow();
    expect(result).not.toHaveProperty("providerKey");
    const attribution = renderer.executionAttribution();
    expect(attribution.providerKey).toBe("youflicks.local.renderer");
    expect(attribution.capability).toBe(RenderCapability.VIDEO_RENDER);
  });

  it("fails honestly when a clip source cannot be read", async () => {
    const renderer = new LocalDeterministicRenderer(storage);
    await expect(
      renderer.render(
        baseInput({
          manifest: {
            ...baseInput().manifest,
            clips: [
              {
                ...baseInput().manifest.clips[0]!,
                storageKey: "projects/proj_1/media/missing/original.bin",
              },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "RENDER_SOURCE_UNRESOLVED" });
  });
});

describe("HttpRendererAdapter", () => {
  it("is unconfigured without credentials and fails honestly", async () => {
    const storage = new LocalStorageAdapter("/tmp/youflicks-unused-render-http");
    const adapter = new HttpRendererAdapter(storage, {
      providerKey: "http.renderer",
    });
    expect(adapter.configured).toBe(false);
    expect(adapter.production).toBe(true);
    await expect(adapter.render(baseInput())).rejects.toMatchObject({
      code: "RENDER_PROVIDER_UNAVAILABLE",
    });
  });
});

describe("fingerprintRenderComposerInput", () => {
  it("is order-independent and ignores destinationKeyHint", () => {
    const a = baseInput();
    const hashA = fingerprintRenderComposerInput(a);
    const hashB = fingerprintRenderComposerInput({
      ...a,
      destinationKeyHint: "projects/proj_1/renders/other/output.mp4",
      manifest: {
        rationale: undefined,
        audioMixNotes: undefined,
        clips: a.manifest.clips,
        outputProfile: a.manifest.outputProfile,
        totalDurationMs: a.manifest.totalDurationMs,
        timelineVersion: a.manifest.timelineVersion,
        timelineId: a.manifest.timelineId,
        schemaVersion: a.manifest.schemaVersion,
      },
    });
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });
});
