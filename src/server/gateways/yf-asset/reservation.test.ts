import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { MockVideoBackend } from "@/server/gateways/yf-asset/backends/mock";
import { HttpQueueVideoBackend } from "@/server/gateways/yf-asset/backends/http-queue";
import { ReplicateVideoBackend } from "@/server/gateways/yf-asset/backends/replicate";
import type { VideoBackend } from "@/server/gateways/yf-asset/backends/types";
import {
  assertLiveGatewayLane,
  GatewayConfigError,
  parseYfAssetGatewayConfig,
  warnIfFlatRateIgnored,
} from "@/server/gateways/yf-asset/config";
import { YfAssetGenerateService } from "@/server/gateways/yf-asset/generate";
import { GatewayJobStore } from "@/server/gateways/yf-asset/jobs";
import { prisma } from "@/server/db";
import { GatewaySpendCapError } from "@/server/gateways/yf-asset/ledger";
import {
  MemoryGatewayReservation,
  PrismaGatewayReservation,
  ReservationStateError,
  type GatewayReservationPort,
  type GatewayReserveInput,
} from "@/server/gateways/yf-asset/reservation";
import { SpendGuard } from "@/server/gateways/yf-asset/spend";
import { estimateLaneCharge, gatewayChargeLedgerIds, requireLaneRate } from "@/server/sg/lane-rate";
import { logger } from "@/lib/logger";

const wan = requireLaneRate("r1-wan27-replicate");
const wanCharge = estimateLaneCharge(wan);

function reserveInput(
  overrides: Partial<GatewayReserveInput> = {},
): GatewayReserveInput {
  const laneId = overrides.laneId ?? wan.laneId;
  const primary = overrides.primaryLedgerId ?? "yf-asset";
  return {
    idempotencyKey: overrides.idempotencyKey ?? `key-${Math.random()}`,
    ledgerIds: overrides.ledgerIds ?? gatewayChargeLedgerIds(primary, laneId),
    laneId,
    providerKey: wan.providerKey,
    capability: "VIDEO_GENERATION",
    modelId: "wan-video/wan-2.7-i2v",
    requestedDurationS: wanCharge.requestedDurationS,
    estimatedBilledSeconds: wanCharge.estimatedBilledSeconds,
    usdPerSecond: wan.usdPerSecond,
    reservedUsd: wanCharge.reservedUsd,
    primaryLedgerId: primary,
    maxJobs: 10,
    maxSpendUsd: 100,
    ...overrides,
  };
}

function exercise(store: GatewayReservationPort) {
  return {
    async matrix() {
      const base = "matrix-" + Math.random().toString(16).slice(2);
      await expect(
        store.reserve(
          reserveInput({
            idempotencyKey: `${base}-cap`,
            primaryLedgerId: `${base}-cap-ledger`,
            ledgerIds: gatewayChargeLedgerIds(`${base}-cap-ledger`, wan.laneId),
            maxJobs: 0,
          }),
        ),
      ).rejects.toBeInstanceOf(GatewaySpendCapError);
      expect(await store.snapshot(`${base}-cap-ledger`)).toMatchObject({ jobsAccepted: 0, spendUsd: 0 });

      const rejected = await store.reserve(
        reserveInput({
          idempotencyKey: `${base}-reject`,
          primaryLedgerId: `${base}-reject`,
          ledgerIds: [`${base}-reject`],
        }),
      );
      const released = await store.release(rejected.id, "SUBMIT_REJECTED");
      expect(released.status).toBe("RELEASED");
      expect(await store.snapshot(`${base}-reject`)).toMatchObject({
        jobsAccepted: 1,
        spendUsd: 0,
        reservedUsd: 0,
        billedSeconds: 0,
        reservedSeconds: 0,
      });

      const billable = await store.reserve(
        reserveInput({
          idempotencyKey: `${base}-bill`,
          primaryLedgerId: `${base}-bill`,
          ledgerIds: [`${base}-bill`],
        }),
      );
      const reconciledFailure = await store.reconcile(billable.id, {
        actualBilledSeconds: billable.estimatedBilledSeconds,
        reason: "FAILURE_BILLABLE",
      });
      expect(reconciledFailure.status).toBe("RECONCILED");
      expect(reconciledFailure.actualUsd).toBeCloseTo(billable.reservedUsd, 5);
      const billSnap = await store.snapshot(`${base}-bill`);
      expect(billSnap.reservedUsd).toBeCloseTo(0, 5);
      expect(billSnap.spendUsd).toBeCloseTo(billable.reservedUsd, 5);
      expect(billSnap.reservedSeconds).toBeCloseTo(0, 5);
      expect(billSnap.billedSeconds).toBeCloseTo(billable.estimatedBilledSeconds, 5);

      const success = await store.reserve(
        reserveInput({
          idempotencyKey: `${base}-ok`,
          primaryLedgerId: `${base}-ok`,
          ledgerIds: [`${base}-ok`],
          estimatedBilledSeconds: 5,
          reservedUsd: 0.5,
        }),
      );
      const done = await store.reconcile(success.id, {
        actualBilledSeconds: 6,
        reason: "SUCCEEDED",
      });
      expect(done.status).toBe("RECONCILED");
      expect(done.actualBilledSeconds).toBe(6);
      expect(done.actualUsd).toBeCloseTo(0.6, 5);
      const okSnap = await store.snapshot(`${base}-ok`);
      expect(okSnap.spendUsd).toBeCloseTo(0.6, 5);
      expect(okSnap.reservedUsd).toBeCloseTo(0, 5);
      expect(okSnap.billedSeconds).toBeCloseTo(6, 5);
      expect(okSnap.reservedSeconds).toBeCloseTo(0, 5);

      const download = await store.reserve(
        reserveInput({
          idempotencyKey: `${base}-dl`,
          primaryLedgerId: `${base}-dl`,
          ledgerIds: [`${base}-dl`],
        }),
      );
      const billedDownload = await store.reconcile(download.id, {
        actualBilledSeconds: download.estimatedBilledSeconds,
        reason: "DOWNLOAD_FAILURE_BILLED",
      });
      expect(billedDownload.status).toBe("RECONCILED");

      const hung = await store.reserve(
        reserveInput({
          idempotencyKey: `${base}-hung`,
          primaryLedgerId: `${base}-hung`,
          ledgerIds: [`${base}-hung`],
        }),
      );
      const before = await store.snapshot(`${base}-hung`);
      const unresolved = await store.markUnreconciled(hung.id, "TIMEOUT");
      const after = await store.snapshot(`${base}-hung`);
      expect(unresolved.status).toBe("UNRECONCILED");
      expect(after).toMatchObject({
        spendUsd: before.spendUsd,
        reservedUsd: before.reservedUsd,
        billedSeconds: before.billedSeconds,
        reservedSeconds: before.reservedSeconds,
      });
      const ops = await store.reconcile(hung.id, {
        actualBilledSeconds: hung.estimatedBilledSeconds,
        reason: "OPS_RECONCILE",
      });
      expect(ops.status).toBe("RECONCILED");
    },
  };
}

describe("GatewaySpendReservation settlement matrix", () => {
  it("covers every matrix transition in memory", async () => {
    await exercise(new MemoryGatewayReservation()).matrix();
  });

  it("is idempotent and rejects reconcile after release", async () => {
    const store = new MemoryGatewayReservation();
    const first = await store.reserve(reserveInput({ idempotencyKey: "same-key", primaryLedgerId: "idem" }));
    const second = await store.reserve(reserveInput({ idempotencyKey: "same-key", primaryLedgerId: "idem" }));
    expect(second.id).toBe(first.id);
    expect((await store.snapshot("idem")).jobsAccepted).toBe(1);

    await store.release(first.id, "SUBMIT_REJECTED");
    const again = await store.release(first.id, "SUBMIT_REJECTED");
    expect(again.status).toBe("RELEASED");
    await expect(
      store.reconcile(first.id, { actualBilledSeconds: 5, reason: "TOO_LATE" }),
    ).rejects.toBeInstanceOf(ReservationStateError);

    const held = await store.reserve(
      reserveInput({ idempotencyKey: "reconcile-twice", primaryLedgerId: "idem-2", ledgerIds: ["idem-2"] }),
    );
    await store.reconcile(held.id, { actualBilledSeconds: 5, reason: "SUCCEEDED" });
    const noop = await store.reconcile(held.id, { actualBilledSeconds: 9, reason: "AGAIN" });
    expect(noop.actualBilledSeconds).toBe(5);
    expect(noop.settleReason).toBe("SUCCEEDED");
  });
});

describe("GatewaySpendReservation Postgres", () => {
  const prefix = `sgpr1-${Date.now()}`;

  afterAll(async () => {
    await prisma.gatewaySpendReservation.deleteMany({
      where: { idempotencyKey: { startsWith: prefix } },
    });
    await prisma.gatewaySpendLedger.deleteMany({
      where: { id: { contains: prefix } },
    });
  });

  it("does not reset ledgers across a new reservation store", async () => {
    const id = `${prefix}-restart`;
    const first = new PrismaGatewayReservation(prisma);
    await first.reserve(
      reserveInput({
        idempotencyKey: `${prefix}-restart-key`,
        primaryLedgerId: id,
        ledgerIds: [id],
        maxJobs: 10,
      }),
    );
    const restarted = new PrismaGatewayReservation(prisma);
    const snap = await restarted.snapshot(id);
    expect(snap.jobsAccepted).toBe(1);
    expect(snap.spendUsd).toBeCloseTo(wanCharge.reservedUsd, 5);
    expect(snap.reservedUsd).toBeCloseTo(wanCharge.reservedUsd, 5);
  });

  it("keeps a bake-off ledger id isolated from yf-asset", async () => {
    const before = await prisma.gatewaySpendLedger.findUnique({ where: { id: "yf-asset" } });
    const bakeoff = `bakeoff:${prefix}-run`;
    const testLaneId = `${prefix}-wan`;
    const store = new PrismaGatewayReservation(prisma);
    await store.reserve(
      reserveInput({
        idempotencyKey: `${prefix}-bakeoff`,
        laneId: testLaneId,
        primaryLedgerId: bakeoff,
        ledgerIds: gatewayChargeLedgerIds(bakeoff, testLaneId),
        maxJobs: 100,
        maxSpendUsd: 1000,
      }),
    );
    const global = await prisma.gatewaySpendLedger.findUnique({ where: { id: "yf-asset" } });
    expect(global?.jobsAccepted ?? 0).toBe(before?.jobsAccepted ?? 0);
    expect(global?.spendUsd ?? 0).toBe(before?.spendUsd ?? 0);
    const row = await store.snapshot(bakeoff);
    expect(row.scopeKind).toBe("BAKEOFF");
    expect(row.jobsAccepted).toBe(1);
    const laneLedgerId = `lane:${testLaneId}`;
    expect(laneLedgerId.startsWith(`lane:${prefix}`)).toBe(true);
    const lane = await store.snapshot(laneLedgerId);
    expect(lane.scopeKind).toBe("LANE");
    expect(lane.jobsAccepted).toBe(1);
  });

  it("serializes 50 reserves so a cap of 10 accepts exactly 10", async () => {
    const id = `${prefix}-cap10`;
    const store = new PrismaGatewayReservation(prisma);
    const attempts = Array.from({ length: 50 }, (_, index) =>
      store.reserve(
        reserveInput({
          idempotencyKey: `${prefix}-cap-${index}`,
          primaryLedgerId: id,
          ledgerIds: [id],
          maxJobs: 10,
          maxSpendUsd: 10_000,
        }),
      ),
    );
    const results = await Promise.allSettled(attempts);
    const accepted = results.filter((result) => result.status === "fulfilled");
    const denied = results.filter((result) => result.status === "rejected");
    expect(accepted).toHaveLength(10);
    expect(denied).toHaveLength(40);
    for (const result of denied) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(GatewaySpendCapError);
      }
    }
    expect((await store.snapshot(id)).jobsAccepted).toBe(10);
  });

  it("serializes two gateway reservation stores on one database", async () => {
    const id = `${prefix}-two-proc`;
    const left = new PrismaGatewayReservation(prisma);
    const right = new PrismaGatewayReservation(prisma);
    const attempts = Array.from({ length: 20 }, (_, index) => {
      const store = index % 2 === 0 ? left : right;
      return store.reserve(
        reserveInput({
          idempotencyKey: `${prefix}-two-${index}`,
          primaryLedgerId: id,
          ledgerIds: [id],
          maxJobs: 4,
          maxSpendUsd: 10_000,
        }),
      );
    });
    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    expect((await left.snapshot(id)).jobsAccepted).toBe(4);
  });

  it("locks global, lane, and cell rows in ascending id order without deadlocking", async () => {
    const globalId = `${prefix}-global`;
    const laneId = `${prefix}-lane:wan`;
    const cellId = `${prefix}-bakeoff:run:cell:C01`;
    const envelopeId = `${prefix}-bakeoff:run`;
    const store = new PrismaGatewayReservation(prisma);
    const groups = [
      [globalId, laneId],
      [laneId, cellId],
      [envelopeId, globalId],
      [cellId, envelopeId, laneId],
    ];
    const attempts = Array.from({ length: 12 }, (_, index) => {
      const ledgerIds = groups[index % groups.length]!;
      return store.reserve(
        reserveInput({
          idempotencyKey: `${prefix}-lock-${index}`,
          primaryLedgerId: ledgerIds[0]!,
          ledgerIds,
          maxJobs: 100,
          maxSpendUsd: 10_000,
        }),
      );
    });
    const results = await Promise.all(attempts);
    expect(results).toHaveLength(12);
    expect(new Set(results.map((row) => row.status))).toEqual(new Set(["RESERVED"]));
  });

  it("lets exactly one of parallel reconcile and release win", async () => {
    const id = `${prefix}-race-settle`;
    const store = new PrismaGatewayReservation(prisma);
    const held = await store.reserve(
      reserveInput({
        idempotencyKey: `${prefix}-race-settle-key`,
        primaryLedgerId: id,
        ledgerIds: [id],
      }),
    );
    const results = await Promise.allSettled([
      store.release(held.id, "RACE_RELEASE"),
      store.reconcile(held.id, { actualBilledSeconds: 5, reason: "RACE_RECONCILE" }),
    ]);
    const won = results.filter((result) => result.status === "fulfilled");
    const lost = results.filter((result) => result.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const final = await store.get(held.id);
    expect(["RELEASED", "RECONCILED"]).toContain(final?.status);
    const snap = await store.snapshot(id);
    if (final?.status === "RELEASED") {
      expect(snap.spendUsd).toBeCloseTo(0, 5);
      expect(snap.reservedUsd).toBeCloseTo(0, 5);
    } else {
      expect(snap.reservedUsd).toBeCloseTo(0, 5);
      expect(snap.spendUsd).toBeCloseTo(wanCharge.reservedUsd, 5);
    }
  });
});

describe("live generate fail-closed and cap", () => {
  it("returns 429 and does not call the backend once the cap is full", async () => {
    const backend = new MockVideoBackend();
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_MODEL: "open.model",
      YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
      YF_GATEWAY_MAX_JOBS: "10",
      YF_GATEWAY_MAX_SPEND_USD: "1000",
      YF_GATEWAY_POLL_MS: "1",
      YF_GATEWAY_LEDGER_ID: `cap-mem-${Date.now()}`,
    });
    const generate = new YfAssetGenerateService(
      config,
      backend,
      new GatewayJobStore(),
      new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob),
      async () =>
        new Response(Buffer.from("clip"), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
      async () => {},
      new MemoryGatewayReservation(),
    );
    const body = {
      model: "open.model",
      kind: "VIDEO_CLIP" as const,
      role: "broll",
      input: { kind: "VIDEO_CLIP", role: "broll" },
    };
    const results = await Promise.all(Array.from({ length: 50 }, () => generate.generate(body)));
    const ok = results.filter((result) => result.ok);
    const denied = results.filter((result) => !result.ok && result.status === 429);
    expect(ok).toHaveLength(10);
    expect(denied).toHaveLength(40);
    for (const result of denied) {
      if (!result.ok) expect(result.body.code).toBe("GATEWAY_SPEND_CAP");
    }
    expect(backend.requests.size).toBe(10);
  });

  it("returns 400 when the configured duration exceeds the lane", async () => {
    const backend = new MockVideoBackend();
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_MODEL: "open.model",
      YF_GATEWAY_LANE_ID: "veo31lite-720",
      YF_GATEWAY_MAX_JOBS: "10",
      YF_GATEWAY_MAX_SPEND_USD: "100",
      YF_GATEWAY_BACKEND_INPUT_JSON: JSON.stringify({ duration: 9 }),
    });
    const generate = new YfAssetGenerateService(
      config,
      backend,
      new GatewayJobStore(),
      new SpendGuard(),
      async () => new Response("nope"),
      async () => {},
      new MemoryGatewayReservation(),
    );
    const result = await generate.generate({
      model: "open.model",
      kind: "VIDEO_CLIP",
      role: "broll",
      input: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("DURATION_UNSUPPORTED");
    }
    expect(backend.requests.size).toBe(0);
  });
});

describe("gateway boot fail-closed", () => {
  let dir = "";

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("refuses a live backend without a lane, an unknown lane, a zero rate, or invalid JSON", async () => {
    const missing = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_MODEL: "open.model",
    });
    expect(() => assertLiveGatewayLane(missing)).toThrow(GatewayConfigError);
    expect(() => assertLiveGatewayLane(missing)).toThrow(/YF_GATEWAY_LANE_ID/);

    const unknown = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "replicate",
      REPLICATE_API_TOKEN: "r8_token",
      YF_GATEWAY_LANE_ID: "not-a-lane",
    });
    expect(() => assertLiveGatewayLane(unknown)).toThrow(/not in the registry/);

    dir = await mkdtemp(path.join(tmpdir(), "youflicks-gw-boot-"));
    const zeroFile = path.join(dir, "zero.json");
    await writeFile(
      zeroFile,
      JSON.stringify({
        registryVersion: "sg-lanes-v1",
        thresholdsVersion: "po-sg-2026-09-25",
        regenCeilings: { "draft-cost": 3, "draft-quality": 2, standard: 2, premium: 2 },
        classOrder: ["draft-cost", "draft-quality", "standard", "premium"],
        processors: [],
        lanes: [
          {
            laneId: "zero-rate",
            laneClass: "standard",
            providerKey: "TBD:zero-rate",
            modelId: "TBD:zero-rate",
            gateway: {
              baseUrlEnv: "SG_LANE_ZERO_RATE_BASE_URL",
              apiKeyEnv: "SG_LANE_ZERO_RATE_API_KEY",
            },
            resolutionTier: "720p",
            usdPerSecond: 0,
            rateRef: "fixture",
            clipDurationS: 5,
            supportedDurationsS: [5],
            billingGranularityS: 1,
            failuresBillable: true,
            audioMode: "OFF",
            enabled: false,
            designation: "NONE",
            gates: {
              HERO: { status: "NOT_QUALIFIED" },
              IDENTITY: { status: "NOT_QUALIFIED" },
              NON_IDENTITY: { status: "NOT_QUALIFIED" },
            },
          },
        ],
      }),
      "utf8",
    );
    const zero = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_MODEL: "open.model",
      YF_GATEWAY_LANE_ID: "zero-rate",
      SG_LANE_REGISTRY_PATH: zeroFile,
    });
    expect(() => assertLiveGatewayLane(zero)).toThrow(/usdPerSecond/);

    const badFile = path.join(dir, "bad.json");
    await writeFile(badFile, "{", "utf8");
    const bad = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_MODEL: "open.model",
      YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
      SG_LANE_REGISTRY_PATH: badFile,
    });
    expect(() => assertLiveGatewayLane(bad)).toThrow(/JSON/);
  });

  it("warns and ignores a flat per-job rate on a live backend", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_MODEL: "open.model",
      YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
      YF_GATEWAY_ESTIMATED_USD_PER_JOB: "0.5",
    });
    expect(config.flatRateIgnored).toBe(true);
    warnIfFlatRateIgnored(config);
    expect(warn).toHaveBeenCalledWith(
      "yf_asset_gateway.flat_rate_ignored",
      expect.objectContaining({ env: "YF_GATEWAY_ESTIMATED_USD_PER_JOB" }),
    );
    warn.mockRestore();
  });

  it("refuses to boot a live gateway on a TBD providerKey", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_MODEL: "open.model",
      YF_GATEWAY_LANE_ID: "boreal-720",
    });
    expect(() => assertLiveGatewayLane(config)).toThrow(/TBD:/);
  });

  it("does not require a lane for mock", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "mock",
      YF_GATEWAY_MODEL: "mock.video",
    });
    expect(assertLiveGatewayLane(config)).toBeUndefined();
    expect(config.flatRateIgnored).toBe(false);
  });
});

describe("live submit and cancel settlement", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  function liveGenerate(backend: VideoBackend, fetchImpl: typeof fetch = async () => new Response("nope", { status: 500 })) {
    const store = new MemoryGatewayReservation();
    const ledgerId = `settle-${Math.random().toString(16).slice(2)}`;
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_MODEL: "open.model",
      YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
      YF_GATEWAY_MAX_JOBS: "10",
      YF_GATEWAY_MAX_SPEND_USD: "100",
      YF_GATEWAY_POLL_MS: "1",
      YF_GATEWAY_TIMEOUT_MS: "30",
      YF_GATEWAY_LEDGER_ID: ledgerId,
    });
    const generate = new YfAssetGenerateService(
      config,
      backend,
      new GatewayJobStore(),
      new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob),
      fetchImpl,
      async () => {},
      store,
    );
    return { generate, store, ledgerId };
  }

  const body = {
    model: "open.model",
    kind: "VIDEO_CLIP" as const,
    role: "broll",
    input: {},
  };

  function row(store: MemoryGatewayReservation, ledgerId: string) {
    const found = store.list().find((item) => item.ledgerIds.includes(ledgerId));
    if (!found) {
      throw new Error(`missing reservation for ${ledgerId}`);
    }
    return found;
  }

  it("keeps a Replicate canceled prediction UNRECONCILED when error is null", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/files")) {
        return new Response(
          JSON.stringify({ urls: { get: "https://api.replicate.com/v1/files/file_1" } }),
          { status: 200 },
        );
      }
      if (init?.method === "POST" && url.includes("/predictions")) {
        return new Response(JSON.stringify({ id: "pred_canceled" }), { status: 200 });
      }
      if (url.endsWith("/predictions/pred_canceled")) {
        return new Response(JSON.stringify({ status: "canceled", error: null }), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    };
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "replicate",
      REPLICATE_API_TOKEN: "r8_test_token",
      YF_GATEWAY_MODEL: "wan-video/wan-2.7-i2v",
      YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
      YF_GATEWAY_MAX_JOBS: "10",
      YF_GATEWAY_MAX_SPEND_USD: "100",
      YF_GATEWAY_POLL_MS: "1",
      YF_GATEWAY_TIMEOUT_MS: "1000",
      YF_GATEWAY_LEDGER_ID: `cancel-${Math.random().toString(16).slice(2)}`,
      YF_GATEWAY_BACKEND_INPUT_JSON: JSON.stringify({ imageBytesBase64: png.toString("base64") }),
    });
    const store = new MemoryGatewayReservation();
    const generate = new YfAssetGenerateService(
      config,
      new ReplicateVideoBackend(config, fetchImpl),
      new GatewayJobStore(),
      new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob),
      fetchImpl,
      async () => {},
      store,
    );
    const result = await generate.generate({
      model: "wan-video/wan-2.7-i2v",
      kind: "VIDEO_CLIP",
      role: "broll",
      input: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected canceled prediction to fail closed");
    expect(result.body.settlement).toBe("UNRECONCILED");
    const held = row(store, config.ledgerId);
    expect(held.status).toBe("UNRECONCILED");
    expect(held.settleReason).toBe("CANCELLED");
    const snap = await store.snapshot(config.ledgerId);
    expect(snap.reservedUsd).toBeCloseTo(wanCharge.reservedUsd, 5);
    expect(snap.spendUsd).toBeCloseTo(wanCharge.reservedUsd, 5);
  });

  it("keeps fetch failed and 502 UNRECONCILED and releases a 422", async () => {
    const cases: Array<{ message: string; status: "UNRECONCILED" | "RELEASED"; settlement: "UNRECONCILED" | "RELEASED" }> = [
      { message: "fetch failed", status: "UNRECONCILED", settlement: "UNRECONCILED" },
      { message: "Replicate submit failed (502): upstream", status: "UNRECONCILED", settlement: "UNRECONCILED" },
      { message: "Replicate submit failed (422): invalid input", status: "RELEASED", settlement: "RELEASED" },
    ];
    for (const item of cases) {
      const backend: VideoBackend = {
        kind: "http",
        async submit() {
          if (item.message === "fetch failed") {
            throw new TypeError("fetch failed");
          }
          throw new Error(item.message);
        },
        async status() {
          return { status: "queued" };
        },
        async result() {
          throw new Error("no result");
        },
      };
      const { generate, store, ledgerId } = liveGenerate(backend);
      const result = await generate.generate(body);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected submit failure");
      expect(result.body.settlement).toBe(item.settlement);
      expect(row(store, ledgerId).status).toBe(item.status);
      const snap = await store.snapshot(ledgerId);
      if (item.status === "RELEASED") {
        expect(snap.reservedUsd).toBeCloseTo(0, 5);
        expect(snap.spendUsd).toBeCloseTo(0, 5);
      } else {
        expect(snap.reservedUsd).toBeCloseTo(wanCharge.reservedUsd, 5);
      }
    }
  });

  it("keeps the hold when a processing webhook arrives mid-poll", async () => {
    const holder: { service?: YfAssetGenerateService } = {};
    let polls = 0;
    const backend: VideoBackend = {
      kind: "http",
      async submit() {
        return { backendRequestId: "pred_processing" };
      },
      async status() {
        polls += 1;
        if (polls === 1) {
          const accepted = holder.service!.acceptWebhook({
            id: "pred_processing",
            status: "processing",
            error: null,
          });
          expect(accepted.status).toBe(202);
          return { status: "running" };
        }
        return { status: "succeeded" };
      },
      async result() {
        return {
          url: "https://example.test/clip.mp4",
          mimeType: "video/mp4",
          durationMs: 5000,
        };
      },
    };
    const harness = liveGenerate(
      backend,
      async () =>
        new Response(Buffer.from("clip"), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
    );
    holder.service = harness.generate;
    const result = await holder.service.generate(body);
    expect(result.ok).toBe(true);
    expect(row(harness.store, harness.ledgerId).status).toBe("RECONCILED");
    const snap = await harness.store.snapshot(harness.ledgerId);
    expect(snap.reservedUsd).toBeCloseTo(0, 5);
    expect(snap.spendUsd).toBeGreaterThan(0);
  });

  it("ends UNRECONCILED when a canceled webhook arrives mid-poll", async () => {
    const holder: { service?: YfAssetGenerateService } = {};
    const backend: VideoBackend = {
      kind: "http",
      async submit() {
        return { backendRequestId: "pred_wh_cancel" };
      },
      async status() {
        holder.service!.acceptWebhook({ id: "pred_wh_cancel", status: "canceled", error: null });
        return { status: "running" };
      },
      async result() {
        throw new Error("result must not be fetched after a canceled webhook");
      },
    };
    const harness = liveGenerate(backend);
    holder.service = harness.generate;
    const result = await holder.service.generate(body);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected canceled webhook to stay unreconciled");
    expect(result.body.settlement).toBe("UNRECONCILED");
    const held = row(harness.store, harness.ledgerId);
    expect(held.status).toBe("UNRECONCILED");
    expect(held.settleReason).toBe("CANCELLED");
    expect((await harness.store.snapshot(harness.ledgerId)).reservedUsd).toBeCloseTo(
      wanCharge.reservedUsd,
      5,
    );
  });

  it("keeps a Replicate 2xx without a prediction id and a typed 502 UNRECONCILED", async () => {
    const missingId = await runReplicateSubmit(
      new Response(JSON.stringify({ status: "starting" }), { status: 200 }),
    );
    expect(missingId.result.ok).toBe(false);
    if (missingId.result.ok) throw new Error("expected missing prediction id");
    expect(missingId.result.body.settlement).toBe("UNRECONCILED");
    expect(row(missingId.store, missingId.ledgerId).status).toBe("UNRECONCILED");
    expect(row(missingId.store, missingId.ledgerId).settleReason).toBe("SUBMIT_UNKNOWN");
    expect((await missingId.store.snapshot(missingId.ledgerId)).reservedUsd).toBeCloseTo(
      wanCharge.reservedUsd,
      5,
    );

    const upstream = await runReplicateSubmit(new Response("upstream", { status: 502 }));
    expect(upstream.result.ok).toBe(false);
    if (upstream.result.ok) throw new Error("expected 502");
    expect(upstream.result.body.settlement).toBe("UNRECONCILED");
    expect(upstream.result.body.error).toMatch(/Replicate submit failed \(502\)/);
    expect(row(upstream.store, upstream.ledgerId).settleReason).toBe("SUBMIT_UNKNOWN");
    expect((await upstream.store.snapshot(upstream.ledgerId)).reservedUsd).toBeCloseTo(
      wanCharge.reservedUsd,
      5,
    );
  });

  it("keeps an http-queue 2xx without a request id UNRECONCILED", async () => {
    const ledgerId = `http-noid-${Math.random().toString(16).slice(2)}`;
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_BACKEND_BASE_URL: "https://queue.other.test",
      YF_GATEWAY_MODEL: "open.model",
      YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
      YF_GATEWAY_MAX_JOBS: "10",
      YF_GATEWAY_MAX_SPEND_USD: "100",
      YF_GATEWAY_LEDGER_ID: ledgerId,
    });
    const backend = new HttpQueueVideoBackend(config, async (_url, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ status: "IN_QUEUE" }), { status: 200 });
      }
      return new Response("no", { status: 404 });
    });
    const store = new MemoryGatewayReservation();
    const generate = new YfAssetGenerateService(
      config,
      backend,
      new GatewayJobStore(),
      new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob),
      async () => new Response("no", { status: 500 }),
      async () => {},
      store,
    );
    const result = await generate.generate(body);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected missing request id");
    expect(result.body.settlement).toBe("UNRECONCILED");
    expect(result.body.error).toMatch(/no request id/);
    expect(row(store, ledgerId).status).toBe("UNRECONCILED");
    expect(row(store, ledgerId).settleReason).toBe("SUBMIT_UNKNOWN");
    expect((await store.snapshot(ledgerId)).reservedUsd).toBeCloseTo(wanCharge.reservedUsd, 5);
  });

  it("keeps provider 408 and 409 UNRECONCILED", async () => {
    for (const status of [408, 409]) {
      const outcome = await runReplicateSubmit(new Response("ambiguous", { status }));
      expect(outcome.result.ok).toBe(false);
      if (outcome.result.ok) throw new Error(`expected ${status} to stay unreconciled`);
      expect(outcome.result.body.settlement).toBe("UNRECONCILED");
      expect(outcome.result.body.error).toMatch(new RegExp(`Replicate submit failed \\(${status}\\)`));
      expect(row(outcome.store, outcome.ledgerId).status).toBe("UNRECONCILED");
      expect(row(outcome.store, outcome.ledgerId).settleReason).toBe("SUBMIT_UNKNOWN");
      expect((await outcome.store.snapshot(outcome.ledgerId)).reservedUsd).toBeCloseTo(
        wanCharge.reservedUsd,
        5,
      );
    }
  });
});

async function runReplicateSubmit(prediction: Response) {
  const ledgerId = `submit-${Math.random().toString(16).slice(2)}`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const config = parseYfAssetGatewayConfig({
    YF_GATEWAY_API_KEY: "gw-key",
    YF_GATEWAY_BACKEND: "replicate",
    REPLICATE_API_TOKEN: "r8_test_token",
    YF_GATEWAY_MODEL: "wan-video/wan-2.7-i2v",
    YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
    YF_GATEWAY_MAX_JOBS: "10",
    YF_GATEWAY_MAX_SPEND_USD: "100",
    YF_GATEWAY_POLL_MS: "1",
    YF_GATEWAY_TIMEOUT_MS: "1000",
    YF_GATEWAY_LEDGER_ID: ledgerId,
    YF_GATEWAY_BACKEND_INPUT_JSON: JSON.stringify({ imageBytesBase64: png.toString("base64") }),
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/files")) {
      return new Response(
        JSON.stringify({ urls: { get: "https://api.replicate.com/v1/files/file_1" } }),
        { status: 200 },
      );
    }
    if (init?.method === "POST" && url.includes("/predictions")) {
      return prediction;
    }
    return new Response("missing", { status: 404 });
  };
  const store = new MemoryGatewayReservation();
  const generate = new YfAssetGenerateService(
    config,
    new ReplicateVideoBackend(config, fetchImpl),
    new GatewayJobStore(),
    new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob),
    fetchImpl,
    async () => {},
    store,
  );
  const result = await generate.generate({
    model: "wan-video/wan-2.7-i2v",
    kind: "VIDEO_CLIP",
    role: "broll",
    input: {},
  });
  return { result, store, ledgerId };
}
