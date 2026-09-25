import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { LANE_CLASSES, ROUTING_SCOPES } from "@/server/sg/constants";
import {
  LOCKED_LANE_CLASSES,
  PROCESSOR_LANE_CLASS,
  applyLaneSuspension,
  listEligibleLanes,
  loadSgLaneRegistry,
  parseLaneRegistry,
  resolutionMeets720pFloor,
  stampRegistryBytes,
  type RegistryLane,
} from "@/server/sg/lane-registry";
const EVIDENCE = "ab".repeat(32);
const SIGNOFF = "po-signoff:fixture";

function notQualified() {
  return { status: "NOT_QUALIFIED" as const };
}

function qualified() {
  return {
    status: "QUALIFIED" as const,
    evidenceSha256: EVIDENCE,
    signoffRef: SIGNOFF,
  };
}

function lane(overrides: Record<string, unknown> = {}) {
  return {
    laneId: "lane-a",
    laneClass: "standard",
    providerKey: "open:model",
    modelId: "open-model",
    gateway: { baseUrlEnv: "SG_LANE_A_BASE_URL", apiKeyEnv: "SG_LANE_A_API_KEY" },
    resolutionTier: "720p",
    usdPerSecond: 0.1,
    rateRef: "ESTIMATE fixture; not a price",
    clipDurationS: 5,
    supportedDurationsS: [5],
    billingGranularityS: 1,
    failuresBillable: true,
    audioMode: "OFF",
    enabled: true,
    designation: "NONE",
    gates: {
      HERO: notQualified(),
      IDENTITY: notQualified(),
      NON_IDENTITY: notQualified(),
    },
    ...overrides,
  };
}

function document(lanes: unknown[], extra: Record<string, unknown> = {}) {
  return {
    registryVersion: "sg-lanes-v1",
    thresholdsVersion: "po-sg-2026-09-25",
    regenCeilings: { "draft-cost": 3, "draft-quality": 2, standard: 2, premium: 2 },
    classOrder: ["draft-cost", "draft-quality", "standard", "premium"],
    lanes,
    processors: [],
    ...extra,
  };
}

type GateFixture = { status: string; evidenceSha256?: string; signoffRef?: string };

function gates(hero: GateFixture, identity: GateFixture = notQualified(), nonIdentity: GateFixture = notQualified()) {
  return { HERO: hero, IDENTITY: identity, NON_IDENTITY: nonIdentity };
}

describe("lane registry validators", () => {
  const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

  afterEach(() => {
    errorSpy.mockClear();
    delete process.env.SG_LANES_SUSPENDED;
    delete process.env.SG_LANES_QUALIFIED;
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  it("rejects QUALIFIED without evidenceSha256", () => {
    const hero = { status: "QUALIFIED", signoffRef: SIGNOFF };
    expect(() => parseLaneRegistry(document([lane({ gates: gates(hero) })]))).toThrow(
      /QUALIFIED requires evidenceSha256/,
    );
  });

  it("rejects QUALIFIED without signoffRef", () => {
    const hero = { status: "QUALIFIED", evidenceSha256: EVIDENCE };
    expect(() => parseLaneRegistry(document([lane({ gates: gates(hero) })]))).toThrow(
      /QUALIFIED requires signoffRef/,
    );
  });

  it("accepts QUALIFIED when evidenceSha256 and signoffRef are both present", () => {
    const parsed = parseLaneRegistry(
      document([
        lane({
          gates: gates(qualified(), qualified(), qualified()),
        }),
      ]),
    );
    expect(parsed.lanes[0]?.gates.HERO.status).toBe("QUALIFIED");
    expect(parsed.lanes[0]?.gates.HERO.evidenceSha256).toBe(EVIDENCE);
    expect(parsed.lanes[0]?.gates.HERO.signoffRef).toBe(SIGNOFF);
  });

  it("rejects HERO QUALIFIED below 720p", () => {
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            resolutionTier: "480p",
            gates: gates(qualified()),
          }),
        ]),
      ),
    ).toThrow(/HERO QUALIFIED requires resolutionTier >= 720p/);
    expect(resolutionMeets720pFloor("480p")).toBe(false);
    expect(resolutionMeets720pFloor("720p")).toBe(true);
  });

  it("rejects IDENTITY QUALIFIED at 480p", () => {
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            resolutionTier: "480p",
            gates: gates(notQualified(), qualified()),
          }),
        ]),
      ),
    ).toThrow(/IDENTITY QUALIFIED requires resolutionTier >= 720p/);
  });

  it("accepts NON_IDENTITY QUALIFIED at 480p", () => {
    const parsed = parseLaneRegistry(
      document([
        lane({
          laneClass: "draft-cost",
          resolutionTier: "480p",
          gates: gates(notQualified(), notQualified(), qualified()),
        }),
      ]),
    );
    expect(parsed.lanes[0]?.gates.NON_IDENTITY.status).toBe("QUALIFIED");
    expect(parsed.lanes[0]?.gates.HERO.status).toBe("NOT_QUALIFIED");
  });

  it("accepts HERO QUALIFIED at 720p, 768p, and 1080p, and rejects unmeasured pro", () => {
    for (const resolutionTier of ["720p", "768p", "1080p"] as const) {
      const parsed = parseLaneRegistry(
        document([
          lane({
            laneId: `tier-${resolutionTier}`,
            providerKey: `open:${resolutionTier}`,
            resolutionTier,
            gates: gates(qualified()),
          }),
        ]),
      );
      expect(parsed.lanes[0]?.resolutionTier).toBe(resolutionTier);
      expect(resolutionMeets720pFloor(resolutionTier)).toBe(true);
    }
    expect(resolutionMeets720pFloor("pro")).toBe(false);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            resolutionTier: "pro",
            gates: gates(qualified()),
          }),
        ]),
      ),
    ).toThrow(/HERO QUALIFIED requires resolutionTier >= 720p/);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            resolutionTier: "pro",
            gates: gates(notQualified(), qualified()),
          }),
        ]),
      ),
    ).toThrow(/IDENTITY QUALIFIED requires resolutionTier >= 720p/);
  });

  it("rejects an enabled lane with a TBD providerKey", () => {
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            enabled: true,
            providerKey: "TBD:lane-a",
          }),
        ]),
      ),
    ).toThrow(/enabled lane must have a non-TBD providerKey/);
  });

  it("accepts TBD:<laneId> only while the lane is disabled", () => {
    const parsed = parseLaneRegistry(
      document([
        lane({
          laneId: "boreal-720",
          providerKey: "TBD:boreal-720",
          modelId: "TBD:boreal-720",
          enabled: false,
          laneClass: "draft-cost",
        }),
      ]),
    );
    expect(parsed.lanes[0]?.enabled).toBe(false);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            laneId: "boreal-720",
            providerKey: "TBD:someone-else",
            enabled: false,
          }),
        ]),
      ),
    ).toThrow(/TBD:<laneId>/);
    const lower = parseLaneRegistry(
      document([
        lane({
          laneId: "boreal-720",
          providerKey: "tbd:boreal-720",
          enabled: false,
        }),
      ]),
    );
    expect(lower.lanes[0]?.providerKey).toBe("tbd:boreal-720");
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            enabled: true,
            providerKey: "tbd:lane-a",
          }),
        ]),
      ),
    ).toThrow(/enabled lane must have a non-TBD providerKey/);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            enabled: true,
            providerKey: " TBD:lane-a",
          }),
        ]),
      ),
    ).toThrow(/whitespace|non-TBD/);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            laneId: "boreal-720",
            providerKey: " TBD:boreal-720",
            enabled: false,
          }),
        ]),
      ),
    ).toThrow(/whitespace/);
  });

  it("rejects a laneId with whitespace or an illegal character", () => {
    expect(() => parseLaneRegistry(document([lane({ laneId: " boreal-720" })]))).toThrow(/laneId/);
    expect(() => parseLaneRegistry(document([lane({ laneId: "Boreal-720" })]))).toThrow(/laneId/);
    expect(() => parseLaneRegistry(document([lane({ laneId: "lane_a" })]))).toThrow(/laneId/);
  });

  it("allows one enabled LEGACY_R1 lane with a real providerKey", () => {
    expect(() =>
      parseLaneRegistry(
        document([
          lane({ designation: "LEGACY_R1" }),
          lane({
            laneId: "legacy-2",
            providerKey: "open:legacy-2",
            designation: "LEGACY_R1",
          }),
        ]),
      ),
    ).toThrow(/at most one LEGACY_R1/);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            designation: "LEGACY_R1",
            enabled: false,
            providerKey: "open:legacy",
          }),
        ]),
      ),
    ).toThrow(/LEGACY_R1 lane must be enabled with a real providerKey/);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            laneId: "legacy",
            designation: "LEGACY_R1",
            enabled: false,
            providerKey: "TBD:legacy",
          }),
        ]),
      ),
    ).toThrow(/LEGACY_R1 lane must be enabled with a real providerKey/);
  });

  it("requires an enabled lane to have a positive rate, a listed clip, and a non-blank signoff", () => {
    expect(() =>
      parseLaneRegistry(document([lane({ enabled: true, usdPerSecond: 0 })])),
    ).toThrow(/usdPerSecond/);
    expect(() =>
      parseLaneRegistry(
        document([lane({ clipDurationS: 7, supportedDurationsS: [5] })]),
      ),
    ).toThrow(/clipDurationS must be one of supportedDurationsS/);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            gates: gates({ status: "NOT_QUALIFIED", signoffRef: " " }),
          }),
        ]),
      ),
    ).toThrow(/signoffRef must be non-blank/);
    const parsed = parseLaneRegistry(document([lane({ enabled: false, usdPerSecond: 0, providerKey: "TBD:lane-a" })]));
    expect(parsed.lanes[0]?.usdPerSecond).toBe(0);
  });

  it("rejects secret-like env names and high-entropy tokens", () => {
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            gateway: { baseUrlEnv: "SG_LANE_A_BASE_URL", apiKeyEnv: "R8_ABC123" },
          }),
        ]),
      ),
    ).toThrow(/env var names|secret-like/);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            rateRef: "token abcDEF1234567890abcdefABCD1234 buried in prose",
          }),
        ]),
      ),
    ).toThrow(/secret-like/);
  });

  it("rejects designation DEFAULT", () => {
    expect(() => parseLaneRegistry(document([lane({ designation: "DEFAULT" })]))).toThrow(
      /designation DEFAULT is rejected/,
    );
    const parsed = parseLaneRegistry(
      document([
        lane({ designation: "NONE" }),
        lane({
          laneId: "legacy",
          providerKey: "open:legacy",
          designation: "LEGACY_R1",
        }),
      ]),
    );
    expect(parsed.lanes.map((item) => item.designation)).toEqual(["NONE", "LEGACY_R1"]);
  });

  it("rejects a missing laneClass and yields zero eligible lanes", async () => {
    const broken = lane();
    delete (broken as { laneClass?: string }).laneClass;
    expect(() => parseLaneRegistry(document([broken]))).toThrow(/laneClass/);
    const dir = await mkdtemp(path.join(tmpdir(), "youflicks-lane-missing-class-"));
    const file = path.join(dir, "registry.json");
    await writeFile(file, JSON.stringify(document([broken])), "utf8");
    try {
      expect(listEligibleLanes({ requiredScopes: ["HERO"], path: file, suspendedLaneIds: [] })).toEqual(
        [],
      );
      expect(errorSpy).toHaveBeenCalledWith(
        "ops.alert",
        expect.objectContaining({ alertKind: "LANE_REGISTRY_INVALID" }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid laneClass and yields zero eligible lanes", async () => {
    const broken = lane({ laneClass: "ultra" });
    expect(() => parseLaneRegistry(document([broken]))).toThrow(/laneClass/);
    const dir = await mkdtemp(path.join(tmpdir(), "youflicks-lane-bad-class-"));
    const file = path.join(dir, "registry.json");
    await writeFile(file, JSON.stringify(document([broken])), "utf8");
    try {
      expect(
        listEligibleLanes({ requiredScopes: ["NON_IDENTITY"], path: file, suspendedLaneIds: [] }),
      ).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith(
        "ops.alert",
        expect.objectContaining({
          alertKind: "LANE_REGISTRY_INVALID",
          message: expect.stringMatching(/No lane is eligible/),
        }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a generative lane that uses the processor class", () => {
    expect(LOCKED_LANE_CLASSES).toEqual(["draft-cost", "draft-quality", "standard", "premium"]);
    expect(LANE_CLASSES).not.toContain(PROCESSOR_LANE_CLASS);
    expect(() => parseLaneRegistry(document([lane({ laneClass: PROCESSOR_LANE_CLASS })]))).toThrow(
      /laneClass/,
    );
  });

  it("rejects a registry whose regen ceilings or class order drift", () => {
    expect(() =>
      parseLaneRegistry(
        document([lane()], {
          regenCeilings: { "draft-cost": 9, "draft-quality": 2, standard: 2, premium: 2 },
        }),
      ),
    ).toThrow(/regenCeilings/);
    expect(() =>
      parseLaneRegistry(
        document([lane()], {
          classOrder: ["premium", "standard", "draft-quality", "draft-cost"],
        }),
      ),
    ).toThrow(/classOrder/);
  });

  it("rejects gateway env values that are not env var names", () => {
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            gateway: { baseUrlEnv: "https://gateway.example", apiKeyEnv: "SG_LANE_A_API_KEY" },
          }),
        ]),
      ),
    ).toThrow(/env var names/);
    expect(() =>
      parseLaneRegistry(
        document([
          lane({
            gateway: { baseUrlEnv: "SG_LANE_A_BASE_URL", apiKeyEnv: "sk-live-secret-value" },
          }),
        ]),
      ),
    ).toThrow(/env var names/);
  });

  it("rejects duplicate lane ids and invalid JSON as an empty eligible set", async () => {
    expect(() =>
      parseLaneRegistry(
        document([
          lane(),
          lane({ providerKey: "open:other" }),
        ]),
      ),
    ).toThrow(/duplicate laneId lane-a/);
    const dir = await mkdtemp(path.join(tmpdir(), "youflicks-lane-bad-json-"));
    const file = path.join(dir, "bad.json");
    await writeFile(file, "{not json", "utf8");
    try {
      expect(listEligibleLanes({ requiredScopes: ["HERO"], path: file, suspendedLaneIds: [] })).toEqual(
        [],
      );
      expect(errorSpy).toHaveBeenCalledWith(
        "ops.alert",
        expect.objectContaining({ alertKind: "LANE_REGISTRY_INVALID" }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("downgrades listed lanes to SUSPENDED and never upgrades", () => {
    const heroLane = lane({
      laneId: "hero-lane",
      providerKey: "open:hero",
      gates: gates(qualified(), qualified(), notQualified()),
    });
    const plain = lane({
      laneId: "plain-lane",
      providerKey: "open:plain",
      enabled: false,
      gates: gates(notQualified()),
    });
    const parsed = parseLaneRegistry(document([heroLane, plain]));
    const downgraded = applyLaneSuspension(parsed.lanes, ["hero-lane", "plain-lane"]);
    for (const scope of ROUTING_SCOPES) {
      expect(downgraded[0]?.gates[scope].status).toBe("SUSPENDED");
      expect(downgraded[1]?.gates[scope].status).toBe("SUSPENDED");
    }
    expect(parsed.lanes[0]?.gates.HERO.status).toBe("QUALIFIED");
    const untouched = applyLaneSuspension(parsed.lanes, ["not-a-lane"]);
    expect(untouched[0]?.gates.HERO.status).toBe("QUALIFIED");
    expect(untouched[1]?.gates.HERO.status).toBe("NOT_QUALIFIED");
    for (const laneRow of downgraded) {
      for (const scope of ROUTING_SCOPES) {
        const before = parsed.lanes.find((item) => item.laneId === laneRow.laneId)?.gates[scope].status;
        const after = laneRow.gates[scope].status;
        if (after !== before) {
          expect(after).toBe("SUSPENDED");
        }
        if (before !== "QUALIFIED") {
          expect(after).not.toBe("QUALIFIED");
        }
      }
    }

    const eligibleBefore = listEligibleLanes({
      requiredScopes: ["HERO"],
      registry: parsed,
      suspendedLaneIds: [],
    });
    expect(eligibleBefore.map((item) => item.laneId)).toEqual(["hero-lane"]);
    const eligibleAfter = listEligibleLanes({
      requiredScopes: ["HERO", "IDENTITY"],
      registry: parsed,
      suspendedLaneIds: ["hero-lane"],
    });
    expect(eligibleAfter).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ignores an env var that would qualify a lane", () => {
    const parsed = parseLaneRegistry(document([lane({ enabled: true })]));
    process.env.SG_LANES_QUALIFIED = "lane-a";
    process.env.SG_LANES_SUSPENDED = "";
    expect(
      listEligibleLanes({
        requiredScopes: ["HERO"],
        registry: parsed,
        suspendedLaneIds: undefined,
      }),
    ).toEqual([]);
    const suspended = listEligibleLanes({
      requiredScopes: ["NON_IDENTITY"],
      registry: parseLaneRegistry(
        document([
          lane({
            gates: gates(qualified(), qualified(), qualified()),
          }),
        ]),
      ),
    });
    process.env.SG_LANES_SUSPENDED = "lane-a";
    expect(suspended.map((item) => item.laneId)).toEqual(["lane-a"]);
    expect(
      listEligibleLanes({
        requiredScopes: ["NON_IDENTITY"],
        registry: parseLaneRegistry(
          document([
            lane({
              gates: gates(qualified(), qualified(), qualified()),
            }),
          ]),
        ),
      }),
    ).toEqual([]);
  });

  it("returns no lanes and does not alert for a valid registry with nothing qualified", () => {
    const parsed = parseLaneRegistry(document([lane()]));
    expect(
      listEligibleLanes({ requiredScopes: ["HERO", "IDENTITY"], registry: parsed, suspendedLaneIds: [] }),
    ).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("committed lane registry", () => {
  const filePath = path.join(process.cwd(), "config/sg-lane-registry.json");

  it("ships nothing QUALIFIED, with R1 as LEGACY_R1 and TBD lanes disabled", () => {
    const text = readFileSync(filePath, "utf8");
    const registry = loadSgLaneRegistry(filePath);
    expect(registry.registryVersion).toBe("sg-lanes-v1");
    expect(registry.thresholdsVersion).toBe("po-sg-2026-09-25");
    expect(registry.regenCeilings).toEqual({
      "draft-cost": 3,
      "draft-quality": 2,
      standard: 2,
      premium: 2,
    });
    expect([...registry.classOrder]).toEqual([...LANE_CLASSES]);

    const enabled = registry.lanes.filter((item) => item.enabled);
    expect(enabled.map((item) => item.laneId)).toEqual(["r1-wan27-replicate"]);
    expect(enabled[0]?.designation).toBe("LEGACY_R1");
    expect(enabled[0]?.laneClass).toBe("standard");
    expect(enabled[0]?.providerKey).toBe("replicate:wan-video/wan-2.7-i2v");
    expect(enabled[0]?.modelId).toBe("wan-video/wan-2.7-i2v");
    expect(enabled[0]?.resolutionTier).toBe("720p");
    expect(enabled[0]?.usdPerSecond).toBe(0.1);
    expect(text).not.toContain('"DEFAULT"');

    const rates: Record<string, number> = {
      "r1-wan27-replicate": 0.1,
      "boreal-720": 0.01,
      "pruna-480-cost": 0.01,
      "pruna-768-cost": 0.025,
      "h3turbo-768": 0.04,
      "veo31lite-720": 0.05,
      "pruna-768-quality": 0.075,
      "kling3-pro-audio-off": 0.112,
      "seedance2-fast-720": 0.2419,
    };
    expect(registry.lanes.map((item) => item.laneId).sort()).toEqual(Object.keys(rates).sort());
    for (const item of registry.lanes) {
      expect(item.usdPerSecond).toBe(rates[item.laneId]);
      expect(item.rateRef).toMatch(/ESTIMATE/i);
      expect(item.rateRef).toMatch(/not a price/i);
      const stripAudio = new Set([
        "veo31lite-720",
        "seedance2-fast-720",
        "h3turbo-768",
        "pruna-480-cost",
        "pruna-768-cost",
        "pruna-768-quality",
      ]);
      expect(item.audioMode).toBe(stripAudio.has(item.laneId) ? "STRIP" : "OFF");
      for (const scope of ROUTING_SCOPES) {
        expect(item.gates[scope].status).toBe("NOT_QUALIFIED");
        expect(item.gates[scope].evidenceSha256).toBeUndefined();
        expect(item.gates[scope].signoffRef).toBeUndefined();
      }
      expect(item.gateway.baseUrlEnv).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(item.gateway.apiKeyEnv).toMatch(/^[A-Z][A-Z0-9_]*$/);
      if (item.laneId === "r1-wan27-replicate") {
        expect(item.designation).toBe("LEGACY_R1");
        expect(item.gateway).toEqual({
          baseUrlEnv: "ASSET_HTTP_BASE_URL",
          apiKeyEnv: "ASSET_HTTP_API_KEY",
        });
      } else {
        expect(item.enabled).toBe(false);
        expect(item.designation).toBe("NONE");
        expect(item.providerKey).toBe(`TBD:${item.laneId}`);
      }
    }

    const tiers: Record<string, string> = {
      "r1-wan27-replicate": "720p",
      "boreal-720": "720p",
      "pruna-480-cost": "480p",
      "pruna-768-cost": "768p",
      "h3turbo-768": "768p",
      "veo31lite-720": "720p",
      "pruna-768-quality": "768p",
      "kling3-pro-audio-off": "pro",
      "seedance2-fast-720": "720p",
    };
    for (const item of registry.lanes) {
      expect(item.resolutionTier).toBe(tiers[item.laneId]);
    }
    expect(registry.lanes.find((item) => item.laneId === "veo31lite-720")?.supportedDurationsS).toEqual([
      4, 6, 8,
    ]);
    expect(registry.lanes.find((item) => item.laneId === "veo31lite-720")?.clipDurationS).toBe(6);
    expect(registry.lanes.find((item) => item.laneId === "veo31lite-720")?.rateRef).toMatch(/0\.03/);
    expect(registry.lanes.find((item) => item.laneId === "veo31lite-720")?.rateRef).toMatch(/0\.05/);
    expect(registry.lanes.find((item) => item.laneId === "h3turbo-768")?.rateRef).toMatch(/LIST/);
    expect(registry.lanes.find((item) => item.laneId === "seedance2-fast-720")?.rateRef).toMatch(/audio always billed/i);
    expect(registry.lanes.find((item) => item.laneId === "seedance2-fast-720")?.audioMode).toBe("STRIP");
    expect(registry.lanes.find((item) => item.laneId === "veo31lite-720")?.audioMode).toBe("STRIP");
    expect(registry.lanes.find((item) => item.laneId === "veo31lite-720")?.usdPerSecond).toBe(0.05);
    expect(registry.lanes.find((item) => item.laneId === "seedance2-fast-720")?.usdPerSecond).toBe(0.2419);
    expect(registry.lanes.find((item) => item.laneId === "h3turbo-768")?.audioMode).toBe("STRIP");
    expect(registry.lanes.find((item) => item.laneId === "pruna-480-cost")?.audioMode).toBe("STRIP");
    expect(registry.lanes.find((item) => item.laneId === "kling3-pro-audio-off")?.audioMode).toBe("OFF");
    expect(registry.lanes.find((item) => item.laneId === "r1-wan27-replicate")?.audioMode).toBe("OFF");

    expect(
      listEligibleLanes({ requiredScopes: ["HERO"], path: filePath, suspendedLaneIds: [] }),
    ).toEqual([]);
    expect(
      listEligibleLanes({ requiredScopes: ["IDENTITY"], path: filePath, suspendedLaneIds: [] }),
    ).toEqual([]);
    expect(
      listEligibleLanes({ requiredScopes: ["NON_IDENTITY"], path: filePath, suspendedLaneIds: [] }),
    ).toEqual([]);
    expect(
      listEligibleLanes({
        requiredScopes: ["HERO", "IDENTITY"],
        path: filePath,
        suspendedLaneIds: [],
      }),
    ).toEqual([]);
  });

  it("keeps the Ken Burns processor outside the generative classes", () => {
    const registry = loadSgLaneRegistry(filePath);
    expect(registry.processors).toHaveLength(1);
    const processor = registry.processors[0];
    expect(processor).toMatchObject({
      laneId: "yf.kenburns.v1",
      laneClass: "processor",
      providerKey: "yf.kenburns.v1",
      usdPerSecond: 0,
      duration: "slot-derived",
      generative: false,
      enabled: false,
    });
    expect(registry.lanes.some((item) => item.laneId === "yf.kenburns.v1")).toBe(false);
  });

  it("records no secret-like values in the registry file", () => {
    const text = readFileSync(filePath, "utf8");
    expect(text).not.toMatch(/sk-|r8_|BEGIN PRIVATE/i);
    const values: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") {
        values.push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value && typeof value === "object") {
        Object.values(value).forEach(walk);
      }
    };
    walk(JSON.parse(text) as unknown);
    for (const value of values) {
      expect(value).not.toMatch(/sk-|r8_|BEGIN PRIVATE|AKIA[0-9A-Z]{16}/i);
      expect(value).not.toMatch(/^https?:\/\//);
      expect(value).not.toMatch(/\bkey_[A-Za-z0-9]{8,}/);
      if (/^[A-Z][A-Z0-9_]*$/.test(value) || /^[a-f0-9]{64}$/.test(value)) {
        continue;
      }
      const tokens = value.match(/[A-Za-z0-9]{24,}/g) ?? [];
      for (const token of tokens) {
        const highEntropy = /[0-9]/.test(token) && /[A-Za-z]/.test(token) && !/^[a-f0-9]{64}$/.test(token);
        expect(highEntropy).toBe(false);
      }
    }
  });

  it("stamps the in-file registry version and the file sha", () => {
    const raw = readFileSync(filePath);
    const stamp = stampRegistryBytes(raw);
    const parsed = JSON.parse(raw.toString("utf8")) as { registryVersion: string };
    expect(stamp.registryVersion).toBe(parsed.registryVersion);
    expect(stamp.registryVersion).toBe("sg-lanes-v1");
    expect(stamp.registrySha256).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(stamp.registryVersion).not.toBe("v0");
    expect(stamp.registrySha256).not.toBe("unavailable");
    const unreadable = stampRegistryBytes(Buffer.from("{not json", "utf8"));
    expect(unreadable).toEqual({ registryVersion: "", registrySha256: "" });
    const invalid = stampRegistryBytes(
      Buffer.from(JSON.stringify({ registryVersion: "sg-lanes-v1" }), "utf8"),
    );
    expect(invalid).toEqual({ registryVersion: "", registrySha256: "" });
    expect(invalid.registryVersion).not.toBe("v0");
    expect(invalid.registrySha256).not.toBe("unavailable");
  });
});

describe("attempt lane class comes from the registry", () => {
  it("reads laneClass from the registry and the hard-coded map is gone", () => {
    const fulfillment = readFileSync(
      path.join(process.cwd(), "src/server/sg/shot-fulfillment.ts"),
      "utf8",
    );
    const asset = readFileSync(path.join(process.cwd(), "src/server/services/asset.ts"), "utf8");
    expect(fulfillment).not.toContain("RECORDED_LANE_CLASS_BY_ID");
    expect(asset).not.toContain("RECORDED_LANE_CLASS_BY_ID");
    expect(asset).toContain("lane.laneClass");
    expect(fulfillment).not.toContain("SG_LANE_REGISTRY_VERSION_V0");
    expect(fulfillment).not.toMatch(/registryVersion:\s*"v0"/);
    expect(fulfillment).not.toMatch(/registryVersion:\s*"unavailable"/);
    expect(fulfillment).toContain("loadSgLaneRegistry");
  });
});

describe("suspension does not add QUALIFIED", () => {
  it("leaves a non-matching lane's gate status untouched", () => {
    const parsed = parseLaneRegistry(
      document([
        lane({
          gates: gates(qualified()),
        }),
      ]),
    );
    const result = applyLaneSuspension(parsed.lanes, []);
    expect(result[0]).toBe(parsed.lanes[0]);
    const typed: RegistryLane[] = result;
    expect(typed[0]?.gates.IDENTITY.status).toBe("NOT_QUALIFIED");
  });
});
