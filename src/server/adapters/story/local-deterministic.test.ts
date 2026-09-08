import { describe, expect, it } from "vitest";
import { HttpStoryComposerAdapter } from "@/server/adapters/story/http-story";
import { LocalDeterministicStoryComposer } from "@/server/adapters/story/local-deterministic";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { StoryCapability } from "@/server/ports/capabilities";
import { fingerprintStoryComposerInput } from "@/server/story/fingerprint";
import type { StoryComposerInput } from "@/server/story/input";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@/server/story/schema";
import { validateStoryDocument } from "@/server/story/validate";

function baseInput(overrides: Partial<StoryComposerInput> = {}): StoryComposerInput {
  return {
    projectId: "proj_1",
    creativePlan: {
      schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
      concept: "Birthday weekend",
      tone: "joyful",
      narrativeApproach: "documentary",
    },
    creativePlanId: "plan_1",
    creativePlanVersion: 3,
    planFingerprint: "abc",
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
    ...overrides,
  };
}

describe("LocalDeterministicStoryComposer", () => {
  it("produces a narrative StoryDocument and is not production", async () => {
    const composer = new LocalDeterministicStoryComposer();
    expect(composer.production).toBe(false);
    const document = await composer.composeStory(baseInput());
    expect(document.schemaVersion).toBe(STORY_DOCUMENT_SCHEMA_VERSION);
    expect(document.source.creativePlanId).toBe("plan_1");
    expect(document.source.creativePlanVersion).toBe(3);
    expect(() => validateStoryDocument(document)).not.toThrow();
    const attribution = composer.executionAttribution();
    expect(attribution.providerKey).toBe("youflicks.local.story");
    expect(attribution.capability).toBe(StoryCapability.STORY_COMPOSITION);
    expect(JSON.stringify(document)).not.toMatch(/startMs|endMs|ffmpeg|timelineClip/i);
  });

  it("uses priorStory for recompose continuity", async () => {
    const composer = new LocalDeterministicStoryComposer();
    const first = await composer.composeStory(baseInput());
    const second = await composer.composeStory(baseInput({ priorStory: first }));
    expect(second.title).toBe(first.title);
    expect(second.spine.opening).toBe(first.spine.opening);
    expect(second.acts.length).toBeGreaterThan(0);
  });
});

describe("HttpStoryComposerAdapter", () => {
  it("is unconfigured without credentials and fails honestly", async () => {
    const adapter = new HttpStoryComposerAdapter({
      providerKey: "http.story",
    });
    expect(adapter.configured).toBe(false);
    expect(adapter.production).toBe(true);
    await expect(adapter.composeStory(baseInput())).rejects.toMatchObject({
      code: "STORY_PROVIDER_UNAVAILABLE",
    });
  });
});

describe("fingerprintStoryComposerInput", () => {
  it("is order-independent for object keys", () => {
    const a = baseInput();
    const b = baseInput();
    const hashA = fingerprintStoryComposerInput(a);
    const hashB = fingerprintStoryComposerInput({
      ...b,
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
