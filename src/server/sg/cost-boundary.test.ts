import { describe, expect, it } from "vitest";
import { GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION } from "@/server/assets/schema";
import { validateGeneratedAssetDocument } from "@/server/assets/validate";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { validateCreativePlan } from "@/server/director/validate";
import { walkCostFieldPaths } from "@/server/sg/cost-boundary";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@/server/story/schema";
import { validateStoryDocument } from "@/server/story/validate";
import { TIMELINE_DOCUMENT_SCHEMA_VERSION } from "@/server/timeline/schema";
import { validateTimelineDocument } from "@/server/timeline/validate";
import type { AssetGeneratorInput } from "@/server/assets/input";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";

function plan() {
  return {
    schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
    concept: "Harbor afternoon",
    tone: "Warm",
    decisions: [{ kind: "tone", summary: "Keep it light", detail: { note: "daylight" } }],
  };
}

function story() {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor afternoon",
    logline: "A family finds its way back to the water.",
    spine: {
      opening: "Arrive at the harbor.",
      development: "The day unfolds.",
      resolution: "They leave together.",
    },
    acts: [
      {
        id: "act-1",
        order: 0,
        title: "Opening",
        purpose: "Establish place.",
        targetDurationMs: 30_000,
        scenes: [
          {
            id: "scene-1",
            order: 0,
            title: "Arrival",
            purpose: "Step onto the dock.",
            dramaticFunction: "exposition",
            mediaRoles: [{ role: "establishing_visual", purpose: "Harbor wide." }],
          },
        ],
      },
    ],
    source: { creativePlanId: "plan_1", creativePlanVersion: 1 },
  };
}

function timeline() {
  return {
    schemaVersion: TIMELINE_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor afternoon",
    totalDurationMs: 3_000,
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
      },
    ],
    unmetMediaRoles: [{ role: "closing_image", storySceneId: "scene-1", reason: "No still." }],
    source: { storyStructureId: "story_1", storyStructureVersion: 1 },
  };
}

function assetDocument() {
  return {
    schemaVersion: GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION,
    kind: "IMAGE",
    role: "intimate_portrait",
    mimeType: "image/png",
    width: 1,
    height: 1,
    checksum: "abc",
    storageKey: "projects/p1/generated/intimate_portrait/abc/original.png",
    origin: "GENERATED",
    fulfillment: { timelineId: "tl_1", timelineVersion: 1, storySceneId: "scene-1" },
    source: { storyStructureId: "story_1", storyStructureVersion: 1 },
  };
}

describe("cost-field walker", () => {
  it("finds nested USD and engine-cost keys and ignores the creative word cost", () => {
    expect(
      walkCostFieldPaths({
        cost: "emotional",
        decisions: [{ detail: { actualUsd: 0.5, note: "daylight" } }],
        engineCost: { costUnits: 5 },
      }),
    ).toEqual(["$.decisions[0].detail.actualUsd", "$.engineCost", "$.engineCost.costUnits"]);
  });

  it("proves no cost field reaches CreativePlan, Story, or Timeline", () => {
    expect(walkCostFieldPaths(validateCreativePlan(plan()))).toEqual([]);
    expect(walkCostFieldPaths(validateStoryDocument(story()))).toEqual([]);
    expect(walkCostFieldPaths(validateTimelineDocument(timeline()))).toEqual([]);

    expect(() => validateCreativePlan({ ...plan(), usdPerSecond: 0.1 })).toThrow(/routing or fulfillment-economics/i);
    expect(() => validateCreativePlan({ ...plan(), billedSeconds: 5 })).toThrow(/routing or fulfillment-economics/i);
    expect(() => validateCreativePlan({ ...plan(), estimatedUsd: 0.5 })).toThrow(/routing or fulfillment-economics/i);
    expect(() => validateCreativePlan({ ...plan(), costUnits: 5 })).toThrow(/engine-cost/i);
    expect(() => validateCreativePlan({ ...plan(), engineCost: { costUnits: 1 } })).toThrow(/engine-cost/i);

    expect(() => validateStoryDocument({ ...story(), usdPerSecond: 0.1 })).toThrow();
    expect(() => validateStoryDocument({ ...story(), actualUsd: 0.5 })).toThrow();
    expect(() => validateTimelineDocument({ ...timeline(), billedSeconds: 5 })).toThrow();
    expect(() => validateTimelineDocument({ ...timeline(), costUnits: 1 })).toThrow();
  });

  it("proves no cost field reaches GeneratedAssetDocument, AssetGeneratorPort input, or a job status", () => {
    const document = validateGeneratedAssetDocument(assetDocument());
    expect(walkCostFieldPaths(document)).toEqual([]);
    expect(() => validateGeneratedAssetDocument({ ...assetDocument(), actualUsd: 0.5 })).toThrow();
    expect(() => validateGeneratedAssetDocument({ ...assetDocument(), costUnits: 5 })).toThrow();

    const input: AssetGeneratorInput = {
      projectId: "p1",
      kind: "IMAGE",
      role: "intimate_portrait",
      creativeHints: { scenePurpose: "Arrival" },
      projectIntent: { mood: "warm" } as AssetGeneratorInput["projectIntent"],
      effectiveBrief: { visualStyle: "natural" } as AssetGeneratorInput["effectiveBrief"],
      timelineId: "tl_1",
      timelineVersion: 1,
    };
    expect(walkCostFieldPaths(input)).toEqual([]);

    const port: AssetGeneratorPort = {
      async generate() {
        return document;
      },
    };
    expect(walkCostFieldPaths(port)).toEqual([]);
    expect(port).not.toHaveProperty("usdPerSecond");

    expect(
      walkCostFieldPaths({
        jobId: "job_1",
        status: "SUCCEEDED",
        error: null,
        inputFingerprint: null,
        assetIds: ["asset_1"],
        createdAt: "2026-09-25T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      }),
    ).toEqual([]);
  });
});
