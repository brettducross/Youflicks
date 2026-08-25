import { describe, expect, it } from "vitest";
import { TasteOrigin } from "@/server/domain/personalization";
import {
  assertNoTasteInProviderPayload,
  tasteHintForCapability,
} from "@/server/personalization/privacy";
import type { TasteProfileView } from "@/server/personalization/views";

const profile: TasteProfileView = {
  id: "tp1",
  userId: "u1",
  notes: "Keep this private",
  updatedAt: new Date().toISOString(),
  preferences: [
    { id: "p1", dimension: "favorite_films", value: "Moonlight", source: TasteOrigin.EXPLICIT },
  ],
  signals: [],
};

describe("taste privacy", () => {
  it("does not send the full taste profile to a capability adapter", () => {
    const hint = tasteHintForCapability(profile, "IMAGE_ANALYSIS");
    expect(hint).toEqual({});
    expect(JSON.stringify(hint)).not.toContain("Moonlight");
    expect(JSON.stringify(hint)).not.toContain("Keep this private");
  });

  it("rejects a provider payload that embeds taste", () => {
    expect(() =>
      assertNoTasteInProviderPayload({ tasteProfile: profile, observations: {} }),
    ).toThrow(/Taste data/);
  });
});
