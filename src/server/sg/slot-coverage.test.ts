import { describe, expect, it } from "vitest";
import { deriveSlotCoverage, panAnchorFromAnalysis, type CoverageAsset, type CoverageClip } from "@/server/sg/slot-coverage";

function video(id: string, durationMs: number | null, status = "READY"): CoverageAsset {
  return { id, kind: "VIDEO", mimeType: "video/mp4", status, durationMs };
}

function photo(id: string, status = "READY"): CoverageAsset {
  return { id, kind: "PHOTO", mimeType: "image/png", status, durationMs: null };
}

function clip(overrides: Partial<CoverageClip> & Pick<CoverageClip, "assetId">): CoverageClip {
  return {
    trackKey: "video.primary",
    sourceKind: "MEDIA_ASSET",
    mediaRole: "establishing_visual",
    storySceneId: "scene-arrive",
    timelineStartMs: 0,
    timelineEndMs: 2000,
    ...overrides,
  };
}

describe("slot coverage", () => {
  it("proves original coverage from one READY video whose duration covers the clip", () => {
    const coverage = deriveSlotCoverage({
      role: "establishing_visual",
      storySceneId: "scene-arrive",
      namedStillId: null,
      clips: [clip({ assetId: "vid" })],
      assets: [video("vid", 2000)],
    });
    expect(coverage.originalCoversSlot).toBe(true);
    expect(coverage.sourceStillExists).toBe(false);
    expect(coverage.sourceStillId).toBeNull();
  });

  it("stays unproven when the video is short, missing, not ready, or not the only clip", () => {
    const base = {
      role: "establishing_visual",
      storySceneId: "scene-arrive",
      namedStillId: null,
    };
    expect(
      deriveSlotCoverage({
        ...base,
        clips: [clip({ assetId: "vid" })],
        assets: [video("vid", 1999)],
      }).originalCoversSlot,
    ).toBe(false);
    expect(
      deriveSlotCoverage({
        ...base,
        clips: [clip({ assetId: "vid" })],
        assets: [video("vid", 4000, "UPLOADING")],
      }).originalCoversSlot,
    ).toBe(false);
    expect(
      deriveSlotCoverage({
        ...base,
        clips: [clip({ assetId: "still" })],
        assets: [photo("still")],
      }).originalCoversSlot,
    ).toBe(false);
    expect(
      deriveSlotCoverage({
        ...base,
        clips: [clip({ assetId: "a" }), clip({ assetId: "b", timelineStartMs: 2000, timelineEndMs: 4000 })],
        assets: [video("a", 4000), video("b", 4000)],
      }).originalCoversSlot,
    ).toBe(false);
    expect(
      deriveSlotCoverage({ ...base, clips: [], assets: [] }).originalCoversSlot,
    ).toBe(false);
  });

  it("proves a still from the enhancement source or the single photo clip, and fails closed on a disagreement", () => {
    const named = deriveSlotCoverage({
      role: "portrait",
      storySceneId: "scene-arrive",
      namedStillId: "still",
      clips: [],
      assets: [photo("still")],
    });
    expect(named.sourceStillExists).toBe(true);
    expect(named.sourceStillId).toBe("still");

    const fromClip = deriveSlotCoverage({
      role: "portrait",
      storySceneId: "scene-arrive",
      namedStillId: null,
      clips: [clip({ assetId: "still", mediaRole: "portrait" })],
      assets: [photo("still")],
    });
    expect(fromClip.sourceStillId).toBe("still");

    const disagree = deriveSlotCoverage({
      role: "portrait",
      storySceneId: "scene-arrive",
      namedStillId: "named",
      clips: [clip({ assetId: "clip-still", mediaRole: "portrait" })],
      assets: [photo("named"), photo("clip-still")],
    });
    expect(disagree.sourceStillExists).toBe(false);
    expect(disagree.sourceStillId).toBeNull();

    const videoNamed = deriveSlotCoverage({
      role: "portrait",
      storySceneId: "scene-arrive",
      namedStillId: "vid",
      clips: [],
      assets: [video("vid", 4000)],
    });
    expect(videoNamed.sourceStillExists).toBe(false);
  });

  it("anchors a detected face on an allowlisted hint and stays at the centre otherwise", () => {
    expect(
      panAnchorFromAnalysis({
        analysisSchemaVersion: "1.0",
        people: {
          people: [{ anonymousPersonId: "p1", faceDetected: true, positionHint: "Left" }],
        },
      }),
    ).toEqual({ panX: 0.25, panY: 0.5, panAnchor: "face" });
    expect(
      panAnchorFromAnalysis({
        analysisSchemaVersion: "1.0",
        people: {
          people: [{ anonymousPersonId: "p1", faceDetected: true, positionHint: "upper right" }],
        },
      }),
    ).toEqual({ panX: 0.75, panY: 0.25, panAnchor: "face" });
    expect(
      panAnchorFromAnalysis({
        analysisSchemaVersion: "9.9",
        people: {
          people: [{ anonymousPersonId: "p1", faceDetected: true, positionHint: "left" }],
        },
      }),
    ).toEqual({ panX: 0.5, panY: 0.5, panAnchor: "center" });
    expect(
      panAnchorFromAnalysis({
        people: {
          people: [{ anonymousPersonId: "p1", faceDetected: true, positionHint: "beside the door" }],
        },
      }),
    ).toEqual({ panX: 0.5, panY: 0.5, panAnchor: "center" });
    expect(panAnchorFromAnalysis({ people: { people: [] } })).toEqual({
      panX: 0.5,
      panY: 0.5,
      panAnchor: "center",
    });
  });
});
