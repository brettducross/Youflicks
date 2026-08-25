import { describe, expect, it } from "vitest";
import { TasteDimension, TasteOrigin } from "@/server/domain/personalization";
import { resolveEffectiveCreativeBrief } from "@/server/personalization/brief";
import type { CreativeIntentView, TasteProfileView } from "@/server/personalization/views";

const taste: TasteProfileView = {
  id: "tp1",
  userId: "u1",
  notes: null,
  updatedAt: new Date().toISOString(),
  preferences: [
    {
      id: "p1",
      dimension: TasteDimension.VISUAL_STYLE,
      value: "Cinematic and slow",
      source: TasteOrigin.EXPLICIT,
    },
    {
      id: "p2",
      dimension: TasteDimension.EMOTIONAL,
      value: "Quiet",
      source: TasteOrigin.EXPLICIT,
    },
    {
      id: "p3",
      dimension: TasteDimension.WHAT_MATTERS,
      value: "Story",
      source: TasteOrigin.EXPLICIT,
    },
  ],
  signals: [],
};

const intent: CreativeIntentView = {
  projectId: "proj1",
  purpose: "Birthday",
  audience: "Family",
  mood: "Funny and fast",
  desiredDurationMs: 90000,
  narrativeStyle: "Montage",
  visualStyle: "Handheld and bright",
  musicStyle: "Upbeat",
  explicitInstructions: "Do not make it slow.",
  extras: null,
};

describe("resolveEffectiveCreativeBrief", () => {
  it("lets project intent override general taste", () => {
    const brief = resolveEffectiveCreativeBrief(taste, intent);
    expect(brief.visualStyle).toBe("Handheld and bright");
    expect(brief.mood).toBe("Funny and fast");
    expect(brief.overriddenByProject).toEqual(
      expect.arrayContaining(["visualStyle", "mood", "narrativeStyle", "musicStyle"]),
    );
    expect(brief.whatMatters).toEqual(["Story"]);
  });

  it("falls back to taste when a project field is empty", () => {
    const brief = resolveEffectiveCreativeBrief(taste, {
      ...intent,
      visualStyle: null,
      mood: null,
    });
    expect(brief.visualStyle).toBe("Cinematic and slow");
    expect(brief.mood).toBe("Quiet");
    expect(brief.overriddenByProject).not.toContain("visualStyle");
  });
});
