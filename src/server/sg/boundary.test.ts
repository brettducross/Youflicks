import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { validateGeneratedAssetDocument } from "@/server/assets/validate";
import { GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION } from "@/server/assets/schema";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { validateCreativePlan } from "@/server/director/validate";
import { SG_ROUTING_PLAN_KEYS } from "@/server/sg/constants";
import { fingerprintCreativePlan } from "@/server/story/fingerprint";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@/server/story/schema";
import { validateStoryDocument } from "@/server/story/validate";
import { fingerprintStoredPlan, parseCreativePlanJson } from "@/server/services/story-contract";
import { TIMELINE_DOCUMENT_SCHEMA_VERSION } from "@/server/timeline/schema";
import { validateTimelineDocument } from "@/server/timeline/validate";

const DENIED_KEYS = [...SG_ROUTING_PLAN_KEYS];

function basePlan() {
  return {
    schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
    concept: "Harbor afternoon",
    tone: "Warm",
    decisions: [{ kind: "tone", summary: "Keep it light", detail: { note: "daylight" } }],
  };
}

function validStory() {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor afternoon",
    logline: "A family finds its way back to the water.",
    spine: {
      opening: "Arrive at the harbor.",
      development: "The day unfolds.",
      resolution: "They leave together.",
    },
    acts: [
      {
        id: "act-1",
        order: 0,
        title: "Opening",
        purpose: "Establish place.",
        targetDurationMs: 30_000,
        scenes: [
          {
            id: "scene-1",
            order: 0,
            title: "Arrival",
            purpose: "Step onto the dock.",
            dramaticFunction: "exposition",
            mediaRoles: [{ role: "establishing_visual", purpose: "Harbor wide." }],
          },
        ],
      },
    ],
    source: {
      creativePlanId: "plan_1",
      creativePlanVersion: 1,
    },
  };
}

function validTimeline() {
  return {
    schemaVersion: TIMELINE_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor afternoon",
    totalDurationMs: 3_000,
    tracks: [
      { trackKey: "video.primary", kind: "VIDEO", label: "Picture" },
      { trackKey: "audio.voice", kind: "AUDIO", label: "Voice" },
      { trackKey: "audio.music", kind: "AUDIO", label: "Music" },
      { trackKey: "caption.main", kind: "CAPTION", label: "Captions" },
    ],
    clips: [
      {
        id: "clip-1",
        trackKey: "video.primary",
        order: 0,
        assetId: "asset_1",
        storySceneId: "scene-1",
        mediaRole: "establishing_visual",
        timelineStartMs: 0,
        timelineEndMs: 3_000,
      },
    ],
    unmetMediaRoles: [{ role: "closing_image", storySceneId: "scene-1", reason: "No still." }],
    source: {
      storyStructureId: "story_1",
      storyStructureVersion: 1,
    },
  };
}

function validAsset() {
  return {
    schemaVersion: GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION,
    kind: "IMAGE",
    role: "intimate_portrait",
    mimeType: "image/png",
    width: 1,
    height: 1,
    checksum: "abc",
    storageKey: "projects/p1/generated/intimate_portrait/abc/original.png",
    origin: "GENERATED",
    fulfillment: {
      timelineId: "tl_1",
      timelineVersion: 1,
      storySceneId: "scene-1",
    },
    source: {
      storyStructureId: "story_1",
      storyStructureVersion: 1,
    },
  };
}

function expectRoutingRejection(run: () => void, pathHint: string) {
  try {
    run();
    throw new Error(`expected routing key to be rejected at ${pathHint}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("DIRECTOR_PLAN_INVALID");
    expect(appError.message).toMatch(/routing or fulfillment-economics/i);
    expect(appError.details).toEqual({ paths: [pathHint] });
  }
}

describe("SG.0 CreativePlan routing-key boundary", () => {
  it("lists exactly the §5.1 denylist and omits generic creative words", () => {
    expect(DENIED_KEYS).toEqual([
      "laneClass",
      "laneId",
      "providerKey",
      "routingScope",
      "requiredScopes",
      "treatmentClass",
      "gateStatus",
      "usdPerSecond",
      "usdPerS",
      "billedSeconds",
      "reservedUsd",
      "estimatedUsd",
      "regenCeiling",
      "spendCapUsd",
      "aiVideoSeconds",
    ]);
    expect(DENIED_KEYS).not.toContain("cost");
    expect(DENIED_KEYS).not.toContain("treatment");
  });

  it("rejects every denied key at the plan root, on a decision, and inside detail", () => {
    for (const key of DENIED_KEYS) {
      expectRoutingRejection(
        () => validateCreativePlan({ ...basePlan(), [key]: "denied" }),
        `plan.${key}`,
      );
      expectRoutingRejection(
        () =>
          validateCreativePlan({
            ...basePlan(),
            decisions: [{ kind: "tone", summary: "warm", [key]: "denied" }],
          }),
        `plan.decisions[0].${key}`,
      );
      expectRoutingRejection(
        () =>
          validateCreativePlan({
            ...basePlan(),
            decisions: [{ kind: "tone", summary: "warm", detail: { [key]: "denied" } }],
          }),
        `plan.decisions[0].detail.${key}`,
      );
    }
  });

  it("reports every nested routing key in one walk", () => {
    expect(() =>
      validateCreativePlan({
        ...basePlan(),
        laneClass: { laneId: "r1-wan27-replicate" },
      }),
    ).toThrow(AppError);
    try {
      validateCreativePlan({
        ...basePlan(),
        laneClass: { laneId: "r1-wan27-replicate" },
      });
    } catch (error) {
      expect((error as AppError).details).toEqual({
        paths: ["plan.laneClass", "plan.laneClass.laneId"],
      });
    }
  });

  it("still rejects commercial keys with the existing message", () => {
    expect(() => validateCreativePlan({ ...basePlan(), planKind: "FREE" })).toThrow(
      /commercial entitlement/i,
    );
    expect(() => validateCreativePlan({ ...basePlan(), engineCost: { costUnits: 1 } })).toThrow(
      /engine-cost/i,
    );
    expect(() =>
      validateCreativePlan({ ...basePlan(), planKind: "FREE", laneId: "r1" }),
    ).toThrow(/commercial entitlement/i);
  });

  it("keeps passthrough creative keys, including cost and treatment", () => {
    const plan = validateCreativePlan({
      ...basePlan(),
      cost: "emotional",
      treatment: "natural light",
      directorNote: "hold the wide",
      rationale: "Mention laneClass and usdPerSecond only as words, not keys.",
      decisions: [{ kind: "tone", summary: "providerKey is not a field here." }],
    });
    expect(plan).toMatchObject({
      schemaVersion: "1.0",
      concept: "Harbor afternoon",
      cost: "emotional",
      treatment: "natural light",
      directorNote: "hold the wide",
    });
  });

  it("reads a stored plan that already contains routing keys without stripping or rejecting", () => {
    const stored = {
      ...basePlan(),
      laneClass: "premium",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      decisions: [
        {
          kind: "tone",
          summary: "warm",
          detail: { usdPerSecond: 0.1, note: "historical" },
        },
      ],
    };
    expect(() => validateCreativePlan(stored)).toThrow(/routing or fulfillment-economics/i);

    const json = stored as Prisma.JsonValue;
    const parsed = parseCreativePlanJson(json);
    expect(parsed).toMatchObject({
      concept: "Harbor afternoon",
      laneClass: "premium",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
    });
    expect(parsed.decisions?.[0]?.detail).toMatchObject({ usdPerSecond: 0.1, note: "historical" });
    expect(fingerprintStoredPlan(json)).toBe(fingerprintCreativePlan(parsed));
    expect(fingerprintStoredPlan(json)).toBe(fingerprintStoredPlan(json));
  });

  it("round-trips a valid plan through write validation and the read path unchanged", () => {
    const raw = basePlan();
    const written = validateCreativePlan(raw);
    const read = parseCreativePlanJson(written as Prisma.JsonValue);
    expect(read).toEqual(written);
    expect(written).toEqual(raw);
    expect(fingerprintStoredPlan(written as Prisma.JsonValue)).toBe(fingerprintCreativePlan(written));
    expect(fingerprintStoredPlan(read as Prisma.JsonValue)).toBe(fingerprintCreativePlan(raw));
  });

  it("does not run the denylist on read-path modules", () => {
    const files = [
      "src/server/services/story-contract.ts",
      "src/server/services/director.ts",
      "src/server/adapters/director/http-director.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src, rel).not.toMatch(/assertNoRoutingPlanFields|SG_ROUTING_PLAN_KEYS/);
    }
    const writePath = readFileSync(
      path.join(process.cwd(), "src/server/services/director-contract.ts"),
      "utf8",
    );
    expect(writePath).toMatch(/assertNoRoutingPlanFields/);
  });
});

describe("strict creative schemas reject routing keys", () => {
  it("rejects every denied key on Story, Timeline, and GeneratedAssetDocument writes", () => {
    expect(validateStoryDocument(validStory()).schemaVersion).toBe("1.0");
    expect(validateTimelineDocument(validTimeline()).schemaVersion).toBe("1.0");
    expect(validateGeneratedAssetDocument(validAsset()).schemaVersion).toBe("1.0");

    for (const key of DENIED_KEYS) {
      expect(() => validateStoryDocument({ ...validStory(), [key]: "denied" })).toThrow(AppError);
      const story = validStory();
      (story.acts[0]!.scenes[0] as Record<string, unknown>)[key] = "denied";
      expect(() => validateStoryDocument(story)).toThrow(AppError);

      expect(() => validateTimelineDocument({ ...validTimeline(), [key]: "denied" })).toThrow(
        AppError,
      );
      const timeline = validTimeline();
      (timeline.clips[0] as Record<string, unknown>)[key] = "denied";
      expect(() => validateTimelineDocument(timeline)).toThrow(AppError);

      expect(() => validateGeneratedAssetDocument({ ...validAsset(), [key]: "denied" })).toThrow(
        AppError,
      );
      const asset = validAsset();
      (asset.fulfillment as Record<string, unknown>)[key] = "denied";
      expect(() => validateGeneratedAssetDocument(asset)).toThrow(AppError);
    }
  });
});
