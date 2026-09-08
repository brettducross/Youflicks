import { describe, expect, it } from "vitest";
import { LocalDeterministicDirector } from "@/server/adapters/director/local-deterministic";
import { HttpDirectorAdapter } from "@/server/adapters/director/http-director";
import { fingerprintDirectorInput } from "@/server/director/fingerprint";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import type { DirectorInput } from "@/server/director/input";
import { AnalysisCapability, DirectorCapability } from "@/server/ports/capabilities";

function baseInput(overrides: Partial<DirectorInput> = {}): DirectorInput {
  return {
    projectId: "proj_1",
    tasteBrief: {
      explicitPreferences: [{ dimension: "visual_style", value: "natural light" }],
      inferredSignalSummary: [{ kind: "USER_CHANGED_EDIT", count: 2 }],
      ignoreGeneralTaste: false,
    },
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
    mediaUnderstanding: [
      {
        assetId: "a1",
        kind: "PHOTO",
        analysis: { analysisSchemaVersion: "1.0", technical: { mimeType: "image/png" } },
      },
    ],
    constraints: {
      desiredDurationMs: 120_000,
      explicitInstructions: "Keep it short",
      ignoreGeneralTaste: false,
    },
    availableCapabilities: [AnalysisCapability.IMAGE_ANALYSIS],
    capabilityAvailability: [
      { capability: AnalysisCapability.IMAGE_ANALYSIS, available: true },
    ],
    priorDecisions: [],
    ...overrides,
  };
}

describe("LocalDeterministicDirector", () => {
  it("produces a meaning-level plan and is not production", async () => {
    const director = new LocalDeterministicDirector();
    expect(director.production).toBe(false);
    const plan = await director.composePlan(baseInput());
    expect(plan.schemaVersion).toBe(CREATIVE_PLAN_SCHEMA_VERSION);
    expect(plan.concept).toMatch(/Birthday|personal film/i);
    const attribution = director.executionAttribution();
    expect(attribution.providerKey).toBe("youflicks.local.director");
    expect(attribution.capability).toBe(DirectorCapability.STORY_REASONING);
    expect(JSON.stringify(plan)).not.toMatch(/confidence|startMs|ffmpeg/i);
  });

  it("includes priorDecisions in the composed plan", async () => {
    const director = new LocalDeterministicDirector();
    const plan = await director.composePlan(
      baseInput({
        priorDecisions: [{ kind: "tone", summary: "Keep the prior warm tone" }],
      }),
    );
    expect(plan.decisions?.[0]?.summary).toBe("Keep the prior warm tone");
  });
});

describe("HttpDirectorAdapter", () => {
  it("is unconfigured without credentials and fails honestly", async () => {
    const adapter = new HttpDirectorAdapter({
      providerKey: "http.director",
    });
    expect(adapter.configured).toBe(false);
    expect(adapter.production).toBe(true);
    await expect(adapter.composePlan(baseInput())).rejects.toMatchObject({
      code: "DIRECTOR_PROVIDER_UNAVAILABLE",
    });
  });
});

describe("fingerprintDirectorInput", () => {
  it("is order-independent for object keys", () => {
    const a = baseInput();
    const b = baseInput();
    const hashA = fingerprintDirectorInput(a);
    const hashB = fingerprintDirectorInput({
      ...b,
      constraints: {
        ignoreGeneralTaste: false,
        explicitInstructions: "Keep it short",
        desiredDurationMs: 120_000,
      },
    });
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });
});
