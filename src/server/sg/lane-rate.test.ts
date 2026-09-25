import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  actualBilledSecondsFromDurationMs,
  estimateLaneCharge,
  LaneDurationError,
  loadLaneRegistry,
  requireLaneRate,
  roundUpToGranularity,
  type LaneRate,
} from "@/server/sg/lane-rate";

function lane(overrides: Partial<LaneRate> = {}): LaneRate {
  return {
    laneId: "fixture",
    providerKey: "fixture:provider",
    usdPerSecond: 0.1,
    clipDurationS: 5,
    supportedDurationsS: [5],
    billingGranularityS: 1,
    failuresBillable: true,
    rateRef: "fixture",
    ...overrides,
  };
}

describe("lane-priced estimate fixtures", () => {
  it("prices Economics rates for a 5s clip", () => {
    expect(estimateLaneCharge(lane({ usdPerSecond: 0.112 })).reservedUsd).toBeCloseTo(0.56, 5);
    expect(estimateLaneCharge(lane({ usdPerSecond: 0.2419 })).reservedUsd).toBeCloseTo(1.2095, 5);
    expect(estimateLaneCharge(lane({ usdPerSecond: 0.1 })).reservedUsd).toBeCloseTo(0.5, 5);
    expect(estimateLaneCharge(lane({ usdPerSecond: 0.01 })).reservedUsd).toBeCloseTo(0.05, 5);
  });

  it("bills Veo 6s when D_req is 5 and supported durations are 4, 6, 8", () => {
    const charge = estimateLaneCharge(
      lane({
        laneId: "veo31lite-720",
        usdPerSecond: 0.05,
        clipDurationS: 6,
        supportedDurationsS: [4, 6, 8],
      }),
      5,
    );
    expect(charge.requestedDurationS).toBe(5);
    expect(charge.estimatedBilledSeconds).toBe(6);
    expect(charge.reservedUsd).toBeCloseTo(0.3, 5);
  });

  it("uses the lane clip duration when no numeric duration is requested", () => {
    const charge = estimateLaneCharge(
      lane({ clipDurationS: 6, supportedDurationsS: [4, 6, 8], usdPerSecond: 0.05 }),
    );
    expect(charge.requestedDurationS).toBe(6);
    expect(charge.estimatedBilledSeconds).toBe(6);
  });

  it("rounds billed seconds up to billing granularity", () => {
    expect(roundUpToGranularity(5, 2)).toBe(6);
    expect(roundUpToGranularity(6, 2)).toBe(6);
    expect(roundUpToGranularity(5.1, 1)).toBe(6);
    expect(roundUpToGranularity(4, 0.5)).toBe(4);
    const charge = estimateLaneCharge(
      lane({
        supportedDurationsS: [5],
        billingGranularityS: 2,
        usdPerSecond: 0.1,
      }),
    );
    expect(charge.estimatedBilledSeconds).toBe(6);
    expect(charge.reservedUsd).toBeCloseTo(0.6, 5);
  });

  it("rejects a requested duration above every supported duration", () => {
    expect(() => estimateLaneCharge(lane({ supportedDurationsS: [4, 6, 8] }), 9)).toThrow(
      LaneDurationError,
    );
  });

  it("falls back to the estimate when durationMs is missing and rounds a real duration up", () => {
    expect(actualBilledSecondsFromDurationMs(undefined, 1, 5)).toEqual({
      seconds: 5,
      flagged: true,
    });
    expect(actualBilledSecondsFromDurationMs(5100, 1, 5)).toEqual({
      seconds: 6,
      flagged: false,
    });
  });

  it("loads the committed registry without secrets and matches the Wan and Kling fixtures", () => {
    const filePath = path.join(process.cwd(), "config/sg-lane-registry.json");
    const text = readFileSync(filePath, "utf8");
    expect(text).not.toMatch(/sk-|r8_|api[_-]?key|secret|BEGIN PRIVATE/i);
    const lanes = loadLaneRegistry(filePath);
    const wan = lanes.find((item) => item.laneId === "r1-wan27-replicate");
    const kling = lanes.find((item) => item.laneId === "kling3-pro-audio-off");
    const seedance = lanes.find((item) => item.laneId === "seedance2-fast-720");
    const boreal = lanes.find((item) => item.laneId === "boreal-720");
    expect(estimateLaneCharge(wan!).reservedUsd).toBeCloseTo(0.5, 5);
    expect(estimateLaneCharge(kling!).reservedUsd).toBeCloseTo(0.56, 5);
    expect(estimateLaneCharge(seedance!).reservedUsd).toBeCloseTo(1.2095, 5);
    expect(estimateLaneCharge(boreal!).reservedUsd).toBeCloseTo(0.05, 5);
    expect(wan?.failuresBillable).toBe(false);
    const veo = requireLaneRate("veo31lite-720", filePath);
    expect(veo.usdPerSecond).toBe(0.05);
    expect(veo.failuresBillable).toBe(true);
    expect(veo.supportedDurationsS).toEqual([4, 6, 8]);
    expect(estimateLaneCharge(veo).reservedUsd).toBeCloseTo(0.3, 5);
    expect(lanes.every((item) => /ESTIMATE/i.test(item.rateRef))).toBe(true);
    expect(lanes.every((item) => /not a price/i.test(item.rateRef))).toBe(true);
  });
});

describe("lane registry fail-closed", () => {
  let dir = "";

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("rejects invalid JSON", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-lane-registry-"));
    const file = path.join(dir, "bad.json");
    await writeFile(file, "{not json", "utf8");
    expect(() => loadLaneRegistry(file)).toThrow(/not valid JSON/);
  });

  it("rejects an unknown lane and a non-positive rate", async () => {
    dir = dir || (await mkdtemp(path.join(tmpdir(), "youflicks-lane-registry-")));
    const file = path.join(dir, "zero.json");
    await writeFile(
      file,
      JSON.stringify({
        lanes: [
          {
            laneId: "free",
            providerKey: "TBD:free",
            usdPerSecond: 0,
            clipDurationS: 5,
            supportedDurationsS: [5],
            billingGranularityS: 1,
            failuresBillable: true,
            rateRef: "fixture",
          },
        ],
      }),
      "utf8",
    );
    expect(() => requireLaneRate("missing", file)).toThrow(/not in the registry/);
    expect(() => requireLaneRate("free", file)).toThrow(/usdPerSecond/);
  });
});
