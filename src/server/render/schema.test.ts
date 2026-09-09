import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { RENDER_MANIFEST_SCHEMA_VERSION } from "@/server/render/schema";
import { validateRenderManifest, validateRenderResultDocument } from "@/server/render/validate";

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
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
        storageKey: "projects/p1/media/media_1/original.png",
        timelineStartMs: 0,
        timelineEndMs: 3000,
      },
    ],
    ...overrides,
  };
}

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    storageKey: "projects/p1/renders/rj_1/output.mp4",
    mimeType: "video/mp4",
    durationMs: 3000,
    byteSize: 128,
    checksum: "abc",
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

describe("RenderManifest schema v1", () => {
  it("requires the locked field tree and YouFlicks output profiles", () => {
    expect(() => validateRenderManifest({ title: "Nope" })).toThrow(AppError);
    const manifest = validateRenderManifest(validManifest());
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.outputProfile).toBe("WEB_1080");
    expect(manifest.clips[0]?.storageKey).not.toMatch(/^https?:\/\//);
  });

  it("rejects vendor-host URLs as storageKey", () => {
    expect(() =>
      validateRenderManifest(
        validManifest({
          clips: [
            {
              clipId: "clip-1",
              trackKey: "video.primary",
              sourceKind: "MEDIA_ASSET",
              sourceId: "media_1",
              storageKey: "https://cdn.vendor.example/clip.mp4",
              timelineStartMs: 0,
              timelineEndMs: 3000,
            },
          ],
        }),
      ),
    ).toThrow(AppError);
  });

  it("rejects FFmpeg/VLC/sponsor/host JSON smuggling", () => {
    expect(() => validateRenderManifest(validManifest({ ffmpeg: { graph: [] } }))).toThrow(AppError);
    expect(() => validateRenderManifest(validManifest({ vlc: true }))).toThrow(AppError);
    expect(() => validateRenderManifest(validManifest({ sponsor: {} }))).toThrow(AppError);
    expect(() => validateRenderManifest(validManifest({ hostJson: { vendor: true } }))).toThrow(
      AppError,
    );
  });

  it("requires at least one clip", () => {
    expect(() => validateRenderManifest(validManifest({ clips: [] }))).toThrow(AppError);
  });
});

describe("RenderResultDocument", () => {
  it("requires opaque storageKey and video mime, and rejects providerKey", () => {
    const document = validateRenderResultDocument(validResult());
    expect(document.storageKey).not.toMatch(/^https?:\/\//);
    expect(() =>
      validateRenderResultDocument(validResult({ storageKey: "https://cdn.vendor.example/out.mp4" })),
    ).toThrow(AppError);
    expect(() =>
      validateRenderResultDocument({ ...validResult(), providerKey: "ffmpeg.cloud" }),
    ).toThrow(/providerKey/i);
  });
});
