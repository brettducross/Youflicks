import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { TIMELINE_DOCUMENT_SCHEMA_VERSION } from "@/server/timeline/schema";
import { validateTimelineDocument } from "@/server/timeline/validate";

function validDocument(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: TIMELINE_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor afternoon",
    totalDurationMs: 6_000,
    tracks: [
      { trackKey: "video.primary", kind: "VIDEO", label: "Picture" },
      { trackKey: "audio.voice", kind: "AUDIO", label: "Voice" },
      { trackKey: "audio.music", kind: "AUDIO", label: "Music" },
      { trackKey: "caption.main", kind: "CAPTION", label: "Captions" },
    ],
    clips: [
      {
        id: "clip-1",
        trackKey: "video.primary",
        order: 0,
        assetId: "asset_1",
        storySceneId: "scene-1",
        mediaRole: "establishing_visual",
        timelineStartMs: 0,
        timelineEndMs: 3_000,
        sourceInMs: 0,
        sourceOutMs: 3_000,
        transitionFromPrevious: "CUT",
      },
    ],
    unmetMediaRoles: [
      { role: "closing_image", storySceneId: "scene-land", reason: "No unused MediaAsset." },
    ],
    source: {
      storyStructureId: "story_1",
      storyStructureVersion: 1,
    },
    ...overrides,
  };
}

describe("TimelineDocument schema v1", () => {
  it("requires the YouFlicks schema version and locked field tree", () => {
    expect(() => validateTimelineDocument({ title: "Nope" })).toThrow(AppError);
    const document = validateTimelineDocument(validDocument());
    expect(document.schemaVersion).toBe("1.0");
    expect(document.clips[0]?.timelineStartMs).toBe(0);
    expect(document.clips[0]?.assetId).toBe("asset_1");
  });

  it("requires assetId on every placed clip and rejects null slots", () => {
    expect(() =>
      validateTimelineDocument(
        validDocument({
          clips: [
            {
              id: "clip-1",
              trackKey: "video.primary",
              order: 0,
              timelineStartMs: 0,
              timelineEndMs: 1000,
            },
          ],
        }),
      ),
    ).toThrow(AppError);
  });

  it("rejects StoryDocument-shaped payloads", () => {
    expect(() =>
      validateTimelineDocument({
        schemaVersion: "1.0",
        spine: { opening: "a", development: "b", resolution: "c" },
        acts: [{ id: "act-1", order: 0, purpose: "x", scenes: [] }],
        source: { creativePlanId: "plan_1", creativePlanVersion: 1 },
      }),
    ).toThrow(/StoryDocument|schema/i);
  });

  it("rejects render, VLC, and host JSON smuggling at the document root", () => {
    expect(() => validateTimelineDocument(validDocument({ ffmpeg: { graph: [] } }))).toThrow(
      AppError,
    );
    expect(() => validateTimelineDocument(validDocument({ vlc: true }))).toThrow(AppError);
    expect(() =>
      validateTimelineDocument(validDocument({ generatedAssetId: "gen_1" })),
    ).toThrow(AppError);
    expect(() => validateTimelineDocument(validDocument({ renderSpec: {} }))).toThrow(AppError);
  });

  it("accepts GENERATED_ASSET clips with generatedAssetId and no assetId", () => {
    const document = validateTimelineDocument(
      validDocument({
        clips: [
          {
            id: "clip-g",
            trackKey: "video.primary",
            order: 0,
            sourceKind: "GENERATED_ASSET",
            generatedAssetId: "gen_1",
            timelineStartMs: 0,
            timelineEndMs: 1000,
          },
        ],
      }),
    );
    expect(document.clips[0]?.sourceKind).toBe("GENERATED_ASSET");
    expect(document.clips[0]?.generatedAssetId).toBe("gen_1");
    expect(document.clips[0]?.assetId).toBeUndefined();
  });

  it("rejects unknown track keys and captionText on non-caption tracks", () => {
    expect(() =>
      validateTimelineDocument(
        validDocument({
          tracks: [{ trackKey: "video.overlay", kind: "VIDEO" }],
        }),
      ),
    ).toThrow(AppError);

    expect(() =>
      validateTimelineDocument(
        validDocument({
          clips: [
            {
              id: "clip-1",
              trackKey: "video.primary",
              order: 0,
              assetId: "asset_1",
              timelineStartMs: 0,
              timelineEndMs: 1000,
              captionText: "illegal",
            },
          ],
        }),
      ),
    ).toThrow(/caption/i);
  });

  it("rejects inverted clip timing", () => {
    expect(() =>
      validateTimelineDocument(
        validDocument({
          clips: [
            {
              id: "clip-1",
              trackKey: "video.primary",
              order: 0,
              assetId: "asset_1",
              timelineStartMs: 2000,
              timelineEndMs: 1000,
            },
          ],
        }),
      ),
    ).toThrow(/timelineEndMs/i);
  });
});
