import { describe, expect, it } from "vitest";
import { HttpTimelineComposerAdapter } from "@/server/adapters/timeline/http-timeline";
import { LocalDeterministicTimelineComposer } from "@/server/adapters/timeline/local-deterministic";
import { TimelineCapability } from "@/server/ports/capabilities";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@/server/story/schema";
import { fingerprintTimelineComposerInput } from "@/server/timeline/fingerprint";
import type { TimelineComposerInput } from "@/server/timeline/input";
import { TIMELINE_DOCUMENT_SCHEMA_VERSION } from "@/server/timeline/schema";
import { validateTimelineDocument } from "@/server/timeline/validate";

function sampleStory(): StoryDocument {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    title: "Birthday weekend",
    spine: {
      opening: "Arrive.",
      development: "The day unfolds.",
      resolution: "They leave together.",
    },
    acts: [
      {
        id: "act-opening",
        order: 0,
        purpose: "Open",
        scenes: [
          {
            id: "scene-arrive",
            order: 0,
            purpose: "Introduce place.",
            dramaticFunction: "exposition",
            mediaRoles: [
              { role: "establishing_visual" },
              { role: "intimate_portrait" },
            ],
          },
        ],
      },
    ],
    source: { creativePlanId: "plan_1", creativePlanVersion: 1 },
  };
}

function baseInput(overrides: Partial<TimelineComposerInput> = {}): TimelineComposerInput {
  return {
    projectId: "proj_1",
    story: sampleStory(),
    storyStructureId: "story_1",
    storyStructureVersion: 2,
    storyFingerprint: "abc",
    mediaInventory: [
      {
        assetId: "a1",
        kind: "PHOTO",
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

describe("LocalDeterministicTimelineComposer", () => {
  it("produces an executable TimelineDocument from existing MediaAssets only", async () => {
    const composer = new LocalDeterministicTimelineComposer();
    expect(composer.production).toBe(false);
    const document = await composer.composeTimeline(baseInput());
    expect(document.schemaVersion).toBe(TIMELINE_DOCUMENT_SCHEMA_VERSION);
    expect(document.source.storyStructureId).toBe("story_1");
    expect(document.source.storyStructureVersion).toBe(2);
    expect(document.clips.every((clip) => clip.assetId === "a1")).toBe(true);
    expect(document.unmetMediaRoles?.some((item) => item.role === "intimate_portrait")).toBe(true);
    expect(() => validateTimelineDocument(document)).not.toThrow();
    const attribution = composer.executionAttribution();
    expect(attribution.providerKey).toBe("youflicks.local.timeline");
    expect(attribution.capability).toBe(TimelineCapability.TIMELINE_COMPOSITION);
    expect(JSON.stringify(document)).not.toMatch(/ffmpeg|vlc|libvlc/i);
    expect(document.clips.every((clip) => !clip.generatedAssetId)).toBe(true);
    expect(document).not.toHaveProperty("generatedAsset");
  });

  it("uses priorTimeline for rebuild continuity of clip choices", async () => {
    const composer = new LocalDeterministicTimelineComposer();
    const first = await composer.composeTimeline(
      baseInput({
        mediaInventory: [
          { assetId: "a1", kind: "PHOTO", durationMs: null, analysisStatus: "READY" },
          { assetId: "a2", kind: "PHOTO", durationMs: null, analysisStatus: "READY" },
        ],
      }),
    );
    const second = await composer.composeTimeline(
      baseInput({
        mediaInventory: [
          { assetId: "a1", kind: "PHOTO", durationMs: null, analysisStatus: "READY" },
          { assetId: "a2", kind: "PHOTO", durationMs: null, analysisStatus: "READY" },
        ],
        priorTimeline: first,
      }),
    );
    expect(second.clips[0]?.assetId).toBe(first.clips[0]?.assetId);
    expect(second.title).toBe(first.title);
  });

  it("places READY GeneratedAssets from generatedInventory and shrinks unmet roles", async () => {
    const composer = new LocalDeterministicTimelineComposer();
    const document = await composer.composeTimeline(
      baseInput({
        generatedInventory: [
          {
            generatedAssetId: "gen_portrait",
            kind: "IMAGE",
            role: "intimate_portrait",
            durationMs: 3000,
            storySceneId: "scene-arrive",
          },
        ],
      }),
    );
    expect(document.clips.some((clip) => clip.sourceKind === "GENERATED_ASSET")).toBe(true);
    expect(
      document.clips.some((clip) => clip.generatedAssetId === "gen_portrait"),
    ).toBe(true);
    expect(
      document.unmetMediaRoles?.some((item) => item.role === "intimate_portrait") ?? false,
    ).toBe(false);
    expect(() => validateTimelineDocument(document)).not.toThrow();
  });

  it("does not invent placeholder clips when media is missing", async () => {
    const composer = new LocalDeterministicTimelineComposer();
    const document = await composer.composeTimeline(baseInput({ mediaInventory: [] }));
    expect(document.clips).toEqual([]);
    expect(document.unmetMediaRoles?.length).toBeGreaterThan(0);
    expect(() => validateTimelineDocument(document)).not.toThrow();
  });
});

describe("HttpTimelineComposerAdapter", () => {
  it("is unconfigured without credentials and fails honestly", async () => {
    const adapter = new HttpTimelineComposerAdapter({
      providerKey: "http.timeline",
    });
    expect(adapter.configured).toBe(false);
    expect(adapter.production).toBe(true);
    await expect(adapter.composeTimeline(baseInput())).rejects.toMatchObject({
      code: "TIMELINE_PROVIDER_UNAVAILABLE",
    });
  });
});

describe("fingerprintTimelineComposerInput", () => {
  it("is order-independent for object keys", () => {
    const a = baseInput();
    const hashA = fingerprintTimelineComposerInput(a);
    const hashB = fingerprintTimelineComposerInput({
      ...a,
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
