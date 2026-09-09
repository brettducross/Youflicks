import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@/server/story/schema";
import type { TimelineComposerInput } from "@/server/timeline/input";
import { assertTimelineComposerInputPrivacy } from "@/server/timeline/privacy";

function baseInput(): TimelineComposerInput {
  return {
    projectId: "p1",
    story: {
      schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
      spine: { opening: "a", development: "b", resolution: "c" },
      acts: [
        {
          id: "act-1",
          order: 0,
          purpose: "Open",
          scenes: [
            {
              id: "scene-1",
              order: 0,
              purpose: "Arrive",
              dramaticFunction: "exposition",
              mediaRoles: [{ role: "establishing_visual" }],
            },
          ],
        },
      ],
      source: { creativePlanId: "plan_1", creativePlanVersion: 1 },
    },
    storyStructureId: "story_1",
    storyStructureVersion: 1,
    mediaInventory: [
      {
        assetId: "a1",
        kind: "PHOTO",
        durationMs: null,
        analysisStatus: "COMPLETED",
        analysisSummary: { sceneDescription: "Harbor" },
      },
    ],
    projectIntent: {
      projectId: "p1",
      purpose: "Birthday",
      audience: null,
      mood: "Warm",
      desiredDurationMs: 90_000,
      narrativeStyle: null,
      visualStyle: null,
      musicStyle: null,
      explicitInstructions: null,
      extras: null,
    },
    effectiveBrief: {
      purpose: "Birthday",
      audience: null,
      mood: "Warm",
      desiredDurationMs: 90_000,
      narrativeStyle: null,
      visualStyle: null,
      musicStyle: null,
      pacing: null,
      whatMatters: [],
      explicitInstructions: null,
      overriddenByProject: [],
    },
  };
}

describe("TimelineComposerInput privacy", () => {
  it("accepts a minimized YouFlicks-owned brief including prior cut continuity", () => {
    expect(() => assertTimelineComposerInputPrivacy(baseInput())).not.toThrow();
    const withPrior = {
      ...baseInput(),
      priorTimeline: {
        title: "Harbor",
        clips: [{ assetId: "a1", trackKey: "video.primary" as const, order: 0 }],
      },
    };
    expect(() => assertTimelineComposerInputPrivacy(withPrior)).not.toThrow();
    const withGenerated = {
      ...baseInput(),
      generatedInventory: [
        {
          generatedAssetId: "gen_1",
          kind: "IMAGE",
          role: "intimate_portrait",
          durationMs: 3000,
        },
      ],
    };
    expect(() => assertTimelineComposerInputPrivacy(withGenerated)).not.toThrow();
    const serialized = JSON.stringify(baseInput());
    expect(serialized).not.toMatch(/apiKey|authorization|sponsor|email|storageKey/i);
    expect(baseInput()).not.toHaveProperty("userId");
  });

  it("rejects credentials, sponsor records, storage keys, identity, render, and GeneratedAsset", () => {
    const dirty = {
      ...baseInput(),
      sponsor: { name: "Harbor Coffee" },
      apiKey: "secret",
      email: "owner@example.com",
      storageKey: "projects/p1/assets/a1/original.png",
      generatedAssetId: "gen_1",
      ffmpeg: { graph: [] },
    } as TimelineComposerInput & Record<string, unknown>;
    expect(() => assertTimelineComposerInputPrivacy(dirty)).toThrow(AppError);
    try {
      assertTimelineComposerInputPrivacy(dirty);
    } catch (error) {
      expect(error).toMatchObject({ code: "TIMELINE_INPUT_INVALID" });
    }
  });
});
