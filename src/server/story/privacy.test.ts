import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import type { StoryComposerInput } from "@/server/story/input";
import { assertStoryComposerInputPrivacy } from "@/server/story/privacy";

function baseInput(): StoryComposerInput {
  return {
    projectId: "p1",
    creativePlan: {
      schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
      concept: "Harbor afternoon",
    },
    creativePlanId: "plan_1",
    creativePlanVersion: 1,
    mediaInventory: [
      {
        assetId: "a1",
        kind: "PHOTO",
        mimeType: "image/png",
        width: 1,
        height: 1,
        durationMs: null,
        analysisStatus: "COMPLETED",
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

describe("StoryComposerInput privacy", () => {
  it("accepts a minimized YouFlicks-owned brief", () => {
    expect(() => assertStoryComposerInputPrivacy(baseInput())).not.toThrow();
    const serialized = JSON.stringify(baseInput());
    expect(serialized).not.toMatch(/apiKey|authorization|sponsor|email|storageKey/i);
    expect(baseInput()).not.toHaveProperty("userId");
  });

  it("rejects credentials, sponsor records, storage keys, identity, and timeline artifacts", () => {
    const dirty = {
      ...baseInput(),
      sponsor: { name: "Harbor Coffee" },
      apiKey: "secret",
      email: "owner@example.com",
      storageKey: "projects/p1/assets/a1/original.png",
      timeline: { clips: [] },
    } as StoryComposerInput & Record<string, unknown>;
    expect(() => assertStoryComposerInputPrivacy(dirty)).toThrow(AppError);
    try {
      assertStoryComposerInputPrivacy(dirty);
    } catch (error) {
      expect(error).toMatchObject({ code: "STORY_INPUT_INVALID" });
    }
  });
});
