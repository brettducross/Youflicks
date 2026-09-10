import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { validateCreativePlan } from "@/server/director/validate";

describe("CreativePlan schema", () => {
  it("requires the YouFlicks schema version", () => {
    expect(() => validateCreativePlan({ concept: "A birthday cut" })).toThrow(AppError);
    expect(() => validateCreativePlan({ concept: "A birthday cut" })).toThrow(/schema/);
  });

  it("accepts version 1.0 with optional sections", () => {
    const plan = validateCreativePlan({
      schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
      concept: "Harbor afternoon",
      tone: "Warm",
      decisions: [{ kind: "tone", summary: "Keep it light" }],
    });
    expect(plan.schemaVersion).toBe("1.0");
    expect(plan.concept).toBe("Harbor afternoon");
  });

  it("rejects planKind on CreativePlan validation", () => {
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Harbor afternoon",
        planKind: "FREE",
      }),
    ).toThrow(AppError);
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Harbor afternoon",
        planKind: "FREE",
      }),
    ).toThrow(/commercial entitlement/i);
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        decisions: [{ kind: "tone", summary: "warm", planKind: "SUBSCRIPTION" }],
      }),
    ).toThrow(/commercial entitlement/i);
  });

  it("rejects adsEnabled and watermarkRequired on CreativePlan validation", () => {
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Harbor afternoon",
        adsEnabled: true,
      }),
    ).toThrow(/commercial entitlement/i);
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Harbor afternoon",
        watermarkRequired: true,
      }),
    ).toThrow(/commercial entitlement/i);
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        decisions: [{ kind: "tone", summary: "warm", advertising: { surface: "IN_MOVIE" } }],
      }),
    ).toThrow(/commercial entitlement/i);
  });

  it("rejects engine cost and usage fields on CreativePlan validation", () => {
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Harbor afternoon",
        engineCost: { costUnits: 12 },
      }),
    ).toThrow(/engine-cost/i);
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Harbor afternoon",
        costUnits: 99,
      }),
    ).toThrow(/engine-cost/i);
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        decisions: [{ kind: "tone", summary: "warm", usageEvent: "MOVIE_GENERATION" }],
      }),
    ).toThrow(/engine-cost/i);
  });

  it("rejects an invalid decision object", () => {
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        decisions: [{ kind: "", summary: "" }],
      }),
    ).toThrow(AppError);
  });
});
