import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import type { RenderComposerInput } from "@/server/render/input";
import { assertRenderComposerInputPrivacy } from "@/server/render/privacy";
import { RENDER_MANIFEST_SCHEMA_VERSION } from "@/server/render/schema";

function baseInput(): RenderComposerInput {
  return {
    projectId: "p1",
    timelineId: "tl_1",
    timelineVersion: 1,
    outputProfile: "WEB_1080",
    destinationKeyHint: "projects/p1/renders/rj_1/output.mp4",
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
          storageKey: "projects/p1/media/media_1/original.png",
          timelineStartMs: 0,
          timelineEndMs: 3000,
        },
      ],
    },
  };
}

describe("RenderComposerInput privacy", () => {
  it("accepts a minimized YouFlicks-owned assembly brief", () => {
    expect(() => assertRenderComposerInputPrivacy(baseInput())).not.toThrow();
    const serialized = JSON.stringify(baseInput());
    expect(serialized).not.toMatch(/apiKey|authorization|sponsor|email|ffmpeg|vlc/i);
    expect(baseInput()).not.toHaveProperty("userId");
  });

  it("rejects credentials, sponsor records, identity, playback, and vendor URLs", () => {
    const dirty = {
      ...baseInput(),
      sponsor: { name: "Harbor Coffee" },
      apiKey: "secret",
      email: "owner@example.com",
      ffmpeg: { graph: [] },
      playbackDevice: { kind: "vlc" },
    } as RenderComposerInput & Record<string, unknown>;
    expect(() => assertRenderComposerInputPrivacy(dirty)).toThrow(AppError);
    expect(() =>
      assertRenderComposerInputPrivacy({
        ...baseInput(),
        destinationKeyHint: "https://cdn.vendor.example/out.mp4",
      }),
    ).toThrow(AppError);
  });
});
