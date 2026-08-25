import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import type { DirectorInput } from "@/server/director/input";
import { assertDirectorInputPrivacy } from "@/server/director/privacy";
import { AnalysisCapability } from "@/server/ports/capabilities";

function baseInput(): DirectorInput {
  return {
    projectId: "p1",
    tasteBrief: {
      explicitPreferences: [{ dimension: "visual_style", value: "cinematic" }],
      inferredSignalSummary: [{ kind: "USER_CHANGED_EDIT", count: 2 }],
      ignoreGeneralTaste: false,
    },
    projectIntent: {
      projectId: "p1",
      purpose: "Birthday",
      audience: null,
      mood: "Funny",
      desiredDurationMs: 300000,
      narrativeStyle: null,
      visualStyle: null,
      musicStyle: null,
      explicitInstructions: "Make this funny.",
      extras: null,
    },
    effectiveBrief: {
      purpose: "Birthday",
      audience: null,
      mood: "Funny",
      desiredDurationMs: 300000,
      narrativeStyle: null,
      visualStyle: "cinematic",
      musicStyle: null,
      pacing: null,
      whatMatters: [],
      explicitInstructions: "Make this funny.",
      overriddenByProject: ["mood"],
    },
    mediaInventory: [],
    mediaUnderstanding: [],
    constraints: {
      desiredDurationMs: 300000,
      explicitInstructions: "Make this funny.",
      ignoreGeneralTaste: false,
    },
    availableCapabilities: [AnalysisCapability.IMAGE_ANALYSIS],
    capabilityAvailability: [{ capability: AnalysisCapability.IMAGE_ANALYSIS, available: true }],
    priorDecisions: [],
  };
}

describe("Director input privacy", () => {
  it("accepts a minimized YouFlicks-owned brief", () => {
    expect(() => assertDirectorInputPrivacy(baseInput())).not.toThrow();
    const serialized = JSON.stringify(baseInput());
    expect(serialized).not.toMatch(/openai|anthropic|gemini|apiKey|sponsor/i);
  });

  it("rejects sponsor data and credentials", () => {
    const dirty = {
      ...baseInput(),
      sponsor: { name: "Harbor Coffee", apiKey: "secret" },
    } as DirectorInput & { sponsor: { name: string; apiKey: string } };
    expect(() => assertDirectorInputPrivacy(dirty)).toThrow(AppError);
    try {
      assertDirectorInputPrivacy(dirty);
    } catch (error) {
      expect(error).toMatchObject({ code: "DIRECTOR_INPUT_INVALID" });
    }
  });
});
