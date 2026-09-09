import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import type { AssetGeneratorInput } from "@/server/assets/input";
import { assertAssetGeneratorInputPrivacy } from "@/server/assets/privacy";

function baseInput(): AssetGeneratorInput {
  return {
    projectId: "p1",
    kind: "IMAGE",
    role: "intimate_portrait",
    storySceneId: "scene-1",
    reason: "No unused MediaAsset.",
    creativeHints: { scenePurpose: "Hold on a face.", briefMood: "warm" },
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
    timelineId: "tl_1",
    timelineVersion: 1,
    storyStructureId: "story_1",
    storyStructureVersion: 1,
  };
}

describe("AssetGeneratorInput privacy", () => {
  it("accepts a minimized YouFlicks-owned generation brief", () => {
    expect(() => assertAssetGeneratorInputPrivacy(baseInput())).not.toThrow();
    const serialized = JSON.stringify(baseInput());
    expect(serialized).not.toMatch(/apiKey|authorization|sponsor|email|storageKey/i);
    expect(baseInput()).not.toHaveProperty("userId");
  });

  it("rejects credentials, sponsor records, storage keys, identity, and render fields", () => {
    const dirty = {
      ...baseInput(),
      sponsor: { name: "Harbor Coffee" },
      apiKey: "secret",
      email: "owner@example.com",
      storageKey: "projects/p1/generated/x/original.png",
      ffmpeg: { graph: [] },
    } as AssetGeneratorInput & Record<string, unknown>;
    expect(() => assertAssetGeneratorInputPrivacy(dirty)).toThrow(AppError);
    try {
      assertAssetGeneratorInputPrivacy(dirty);
    } catch (error) {
      expect(error).toMatchObject({ code: "ASSET_INPUT_INVALID" });
    }
  });
});
