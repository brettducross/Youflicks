import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { POST as hygieneRoute } from "@/app/api/ops/sg/hygiene/route";
import { POST as inviteRoute } from "@/app/api/ops/beta-invites/route";
import { GET as lanesRoute } from "@/app/api/ops/sg/lanes/route";
import type { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { opsBearerAuthorized } from "@/server/ops/authorize";
import { prisma } from "@/server/db";
import { PrismaAiVideoBudget } from "@/server/sg/ai-video-budget";
import { buildLaneScopeDayRollups, readLaneScopeDayRollups, readOpenExposure } from "@/server/sg/lane-meter-rollup";
import {
  aiVideoSecondsUsageEventId,
  recordSettledAiVideoSeconds,
} from "@/server/sg/metering";
import {
  STALE_RESERVED_FLOOR_MS,
  UNRECONCILED_SWEEP_DEFAULT_MS,
  UNRECONCILED_SWEEP_FLOOR_MS,
  parseSweepAgeMs,
  readReconciliationFlags,
  reconciliationFieldMismatch,
  runOpsHygiene,
  sweepShouldMeter,
} from "@/server/sg/ops-hygiene";
import { blocksAutomaticPaidRetry, decide } from "@/server/sg/policy";
import { PrismaShotFulfillment } from "@/server/sg/shot-fulfillment";
import { ProjectService } from "@/server/services/projects";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("SG PR-11 ops hygiene", () => {
  const userId = `sg-pr11-${Date.now()}`;
  const projects = new ProjectService();
  const budgets = new PrismaAiVideoBudget(prisma);
  const records = new PrismaShotFulfillment(prisma);
  let projectId = "";

  afterAll(async () => {
    await prisma.usageEvent.deleteMany({ where: { userId } });
    if (projectId) {
      await prisma.gatewaySpendReservation.deleteMany({
        where: { idempotencyKey: { startsWith: `pr11-${userId}` } },
      });
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId }] },
      });
      await prisma.job.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function readyProject() {
    if (projectId) return projectId;
    await prisma.user.create({
      data: { id: userId, name: "Ops", email: `${userId}@example.com`, emailVerified: true },
    });
    const project = await projects.create(userId, { title: "Ops", logline: "PR-11" });
    projectId = project.id;
    return projectId;
  }

  async function slotFor(role: string) {
    const project = await readyProject();
    return records.ensureSlot({
      projectId: project,
      timelineId: "tl-pr11",
      timelineVersion: 1,
      role,
    });
  }

  async function reserve(label: string, laneId: string) {
    const project = await readyProject();
    return budgets.reserve({
      idempotencyKey: `${userId}-${label}`,
      projectId: project,
      userId,
      windowKey: "2026-09-30",
      laneId,
      providerKey: `open:${label}`,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
      caps: {},
    });
  }

  function ages(unreconciledMinAgeMs = DAY, staleReservedMinAgeMs = 2 * HOUR) {
    return { unreconciledMinAgeMs, staleReservedMinAgeMs, now: new Date() };
  }

  it("keeps a safe failure token on SUBMIT_REJECTED and rejects an unsafe one", () => {
    expect(reconciliationFieldMismatch(
      { laneId: "lane-a", modelId: "model-a" },
      { laneId: "lane-a", modelId: "model-a" },
    )).toEqual([]);
    expect(reconciliationFieldMismatch(
      { laneId: "lane-a", modelId: null },
      { laneId: "lane-a", modelId: null },
    )).toEqual([]);
    expect(reconciliationFieldMismatch(
      { laneId: "lane-a", modelId: "model-a" },
      { laneId: "lane-b", modelId: "model-a" },
    )).toEqual(["laneId"]);
    expect(reconciliationFieldMismatch(
      { laneId: "lane-a", modelId: null },
      { laneId: "lane-a", modelId: "model-b" },
    )).toEqual(["modelId"]);
  });

  it("rejects sweep ages below the floor and absurd values", () => {
    expect(parseSweepAgeMs(undefined, UNRECONCILED_SWEEP_DEFAULT_MS, UNRECONCILED_SWEEP_FLOOR_MS, "AGE")).toBe(
      UNRECONCILED_SWEEP_DEFAULT_MS,
    );
    expect(parseSweepAgeMs("", UNRECONCILED_SWEEP_DEFAULT_MS, UNRECONCILED_SWEEP_FLOOR_MS, "AGE")).toBe(
      UNRECONCILED_SWEEP_DEFAULT_MS,
    );
    for (const raw of ["1", "0", "1000", "1.5", "-5", "abc", "1e6"]) {
      expect(() => parseSweepAgeMs(raw, DAY, STALE_RESERVED_FLOOR_MS, "AGE")).toThrow(/AGE/);
    }
  });

  it("does not meter UNRECONCILED, RELEASED, RESERVED, or zero-second holds", () => {
    expect(sweepShouldMeter({ status: "UNRECONCILED", actualBilledSeconds: 5 })).toBe(false);
    expect(sweepShouldMeter({ status: "RELEASED", actualBilledSeconds: 5 })).toBe(false);
    expect(sweepShouldMeter({ status: "RESERVED", actualBilledSeconds: 5 })).toBe(false);
    expect(sweepShouldMeter({ status: "RECONCILED", actualBilledSeconds: 0 })).toBe(false);
    expect(sweepShouldMeter({ status: "RECONCILED", actualBilledSeconds: 5 })).toBe(true);
  });

  it("writes the meter through the injected client", async () => {
    const calls: string[] = [];
    const db = {
      usageEvent: {
        create: async (args: { data: { id: string } }) => {
          calls.push(args.data.id);
          return { id: args.data.id };
        },
      },
    } as unknown as Pick<PrismaClient, "usageEvent">;
    await recordSettledAiVideoSeconds(
      {
        id: "hold-injected",
        userId: "u",
        projectId: "p",
        providerKey: "open:x",
        status: "RECONCILED",
        settleReason: "SUCCEEDED",
        actualBilledSeconds: 3,
      },
      db,
    );
    expect(calls).toEqual([aiVideoSecondsUsageEventId("hold-injected")]);
  });

  it("leaves an aged unknown UNRECONCILED hold counted and listed", async () => {
    const laneId = `pr11-${userId}-unknown`;
    const held = await reserve("unknown", laneId);
    await budgets.markUnreconciled(held.id, "GATEWAY_UNRECONCILED");
    const old = new Date(Date.now() - 2 * DAY);
    await prisma.aiVideoBudgetReservation.update({
      where: { id: held.id },
      data: { createdAt: old, settledAt: old },
    });
    const report = await runOpsHygiene(prisma, budgets, ages());
    const row = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: held.id } });
    expect(row.status).toBe("UNRECONCILED");
    expect(row.actualBilledSeconds).toBeNull();
    expect(row.actualUsd).toBeNull();
    expect(report.unreconciled.stillUnreconciled.find((item) => item.id === held.id)).toMatchObject({
      laneId,
      settleReason: "GATEWAY_UNRECONCILED",
      estimatedUsd: 0.5,
    });
    expect(await prisma.usageEvent.count({ where: { id: aiVideoSecondsUsageEventId(held.id) } })).toBe(0);
  });

  it("does not invent actuals when a reconciled gateway omitted them", async () => {
    const laneId = `pr11-${userId}-no-actual`;
    const held = await reserve("no-actual", laneId);
    await budgets.markUnreconciled(held.id, "GATEWAY_UNRECONCILED");
    const gateway = await prisma.gatewaySpendReservation.create({
      data: {
        ledgerIds: ["yf-asset"],
        laneId,
        providerKey: "open:gw",
        capability: "VIDEO_GENERATION",
        modelId: "model-a",
        idempotencyKey: `pr11-${userId}-no-actual-gw`,
        requestedDurationS: 5,
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.1,
        reservedUsd: 0.5,
        status: "RECONCILED",
        settleReason: "SUCCEEDED",
        actualBilledSeconds: null,
        actualUsd: null,
      },
    });
    await prisma.aiVideoBudgetReservation.update({
      where: { id: held.id },
      data: {
        gatewayReservationId: gateway.id,
        createdAt: new Date(Date.now() - 2 * DAY),
        settledAt: new Date(Date.now() - 2 * DAY),
      },
    });
    await runOpsHygiene(prisma, budgets, ages());
    const row = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: held.id } });
    expect(row.status).toBe("UNRECONCILED");
    expect(row.actualBilledSeconds).toBeNull();
    expect(row.actualUsd).toBeNull();
  });

  it("releases an aged hold when the gateway settlement is non-billable and rewrites the timeout", async () => {
    const laneId = `pr11-${userId}-released`;
    const slot = await slotFor("released");
    const held = await reserve("released", laneId);
    const attempt = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "draft-cost",
      laneId,
      providerKey: "open:released",
      modelId: "model-a",
      requiredScopes: slot.requiredScopes,
      budgetReservationId: held.id,
      estimatedBilledSeconds: 5,
      usdPerSecond: 9,
      estimatedUsd: 45,
    });
    await budgets.markUnreconciled(held.id, "TIMEOUT");
    await records.finishAttempt({
      attemptId: attempt.id,
      outcome: "TIMEOUT_UNRECONCILED",
      failureCode: "TIMEOUT",
    });
    const gateway = await prisma.gatewaySpendReservation.create({
      data: {
        ledgerIds: ["yf-asset"],
        laneId,
        providerKey: "open:gw",
        capability: "VIDEO_GENERATION",
        modelId: "model-a",
        idempotencyKey: `pr11-${userId}-released-gw`,
        requestedDurationS: 5,
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.1,
        reservedUsd: 0.5,
        status: "RELEASED",
        settleReason: "SUBMIT_REJECTED",
      },
    });
    const old = new Date(Date.now() - 2 * DAY);
    await prisma.aiVideoBudgetReservation.update({
      where: { id: held.id },
      data: { gatewayReservationId: gateway.id, createdAt: old, settledAt: old },
    });
    const before = await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot.id } });
    await runOpsHygiene(prisma, budgets, ages());
    const row = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: held.id } });
    const rewritten = await prisma.shotFulfillmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.status).toBe("RELEASED");
    expect(row.settleReason).toBe("SUBMIT_REJECTED");
    expect(row.actualBilledSeconds).toBeNull();
    expect(rewritten.outcome).toBe("FAILED");
    expect(rewritten.failureCode).toBe("RELEASED:TIMEOUT");
    expect(rewritten.actualUsd).toBeNull();
    expect(blocksAutomaticPaidRetry("FAILED", "ENFORCED")).toBe(false);
    expect(await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot.id } })).toBe(before);
    expect(await prisma.usageEvent.count({ where: { id: aiVideoSecondsUsageEventId(held.id) } })).toBe(0);
  });

  it("reconciles gateway actuals once, unblocks a later plan, and still counts the attempt", async () => {
    const laneId = `pr11-${userId}-reconcile`;
    const slot = await slotFor("reconcile");
    const held = await reserve("reconcile", laneId);
    const attempt = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "draft-cost",
      laneId: "attempt-lane-ignored",
      providerKey: "attempt-must-not-win",
      modelId: "attempt-model",
      requiredScopes: ["NON_IDENTITY"],
      budgetReservationId: held.id,
      estimatedBilledSeconds: 5,
      usdPerSecond: 9,
      estimatedUsd: 45,
    });
    await prisma.shotFulfillmentAttempt.update({
      where: { id: attempt.id },
      data: { actualUsd: 999, actualBilledSeconds: 999 },
    });
    await budgets.markUnreconciled(held.id, "TIMEOUT");
    await records.finishAttempt({
      attemptId: attempt.id,
      outcome: "TIMEOUT_UNRECONCILED",
      failureCode: "TIMEOUT",
    });
    const blocked = decide(
      { requiredScopes: ["NON_IDENTITY"], routingMode: "ENFORCED" },
      {
        lanes: [
          {
            laneId: "lane-a",
            laneClass: "draft-cost",
            providerKey: "open:lane-a",
            enabled: true,
            healthy: true,
            designation: "NONE",
            resolutionTier: "720p",
            modelId: "model-a",
            gates: { HERO: "QUALIFIED", IDENTITY: "QUALIFIED", NON_IDENTITY: "QUALIFIED" },
          },
        ],
      },
      {},
      [{ laneClass: "draft-cost", outcome: "TIMEOUT_UNRECONCILED", classAttemptNo: 1 }],
    );
    expect(blocked.treatment).toBe("DEFER");
    expect(blocksAutomaticPaidRetry("TIMEOUT_UNRECONCILED", "ENFORCED")).toBe(true);

    const gateway = await prisma.gatewaySpendReservation.create({
      data: {
        ledgerIds: ["yf-asset"],
        laneId,
        providerKey: "open:gw",
        capability: "VIDEO_GENERATION",
        modelId: "model-a",
        idempotencyKey: `pr11-${userId}-reconcile-gw`,
        requestedDurationS: 5,
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.2,
        reservedUsd: 1,
        status: "RECONCILED",
        settleReason: "SUCCEEDED",
        actualBilledSeconds: 4,
        actualUsd: 0.8,
      },
    });
    const old = new Date(Date.now() - 2 * DAY);
    await prisma.aiVideoBudgetReservation.update({
      where: { id: held.id },
      data: { gatewayReservationId: gateway.id, createdAt: old, settledAt: old },
    });
    const beforeAttempts = await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot.id } });
    await runOpsHygiene(prisma, budgets, ages());
    await runOpsHygiene(prisma, budgets, ages());
    const row = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: held.id } });
    const rewritten = await prisma.shotFulfillmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.status).toBe("RECONCILED");
    expect(row.actualBilledSeconds).toBe(4);
    expect(row.actualUsd).toBeCloseTo(0.4, 5);
    expect(rewritten.outcome).toBe("FAILED");
    expect(rewritten.actualBilledSeconds).toBe(4);
    expect(rewritten.actualUsd).toBeCloseTo(0.4, 5);
    expect(rewritten.actualUsd).not.toBe(999);
    expect(blocksAutomaticPaidRetry(rewritten.outcome as "FAILED", "ENFORCED")).toBe(false);
    const later = decide(
      { requiredScopes: ["NON_IDENTITY"], routingMode: "ENFORCED" },
      {
        lanes: [
          {
            laneId: "lane-a",
            laneClass: "draft-cost",
            providerKey: "open:lane-a",
            enabled: true,
            healthy: true,
            designation: "NONE",
            resolutionTier: "720p",
            modelId: "model-a",
            gates: { HERO: "QUALIFIED", IDENTITY: "QUALIFIED", NON_IDENTITY: "QUALIFIED" },
          },
        ],
      },
      {},
      [{ laneClass: "draft-cost", outcome: "FAILED", classAttemptNo: rewritten.classAttemptNo }],
    );
    expect(later.treatment).toBe("GENERATE");
    expect(await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot.id } })).toBe(beforeAttempts);
    const next = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "draft-cost",
      laneId,
      providerKey: "open:next",
      requiredScopes: ["NON_IDENTITY"],
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    expect(next.classAttemptNo).toBe(2);
    expect(await prisma.usageEvent.count({ where: { id: aiVideoSecondsUsageEventId(held.id) } })).toBe(1);

    await prisma.shotFulfillment.update({ where: { id: slot.id }, data: { scope: "NON_IDENTITY" } });
    const rolled = (await readLaneScopeDayRollups(prisma, 14)).rows.find((item) => item.laneId === laneId);
    expect(rolled?.actualUsd).toBeCloseTo(0.4, 5);
    expect(rolled?.laneId).toBe(laneId);
    expect(rolled?.laneId).not.toBe("attempt-lane-ignored");
  });

  it("restores one usage row for a reconciled hold and does not duplicate it", async () => {
    const laneId = `pr11-${userId}-meter`;
    const held = await reserve("meter", laneId);
    await budgets.reconcile(held.id, { actualBilledSeconds: 5, reason: "SUCCEEDED" });
    await prisma.usageEvent.deleteMany({ where: { id: aiVideoSecondsUsageEventId(held.id) } });
    expect(await prisma.usageEvent.count({ where: { id: aiVideoSecondsUsageEventId(held.id) } })).toBe(0);
    const first = await runOpsHygiene(prisma, budgets, ages());
    expect(first.meter.inserted).toBeGreaterThanOrEqual(1);
    expect(await prisma.usageEvent.count({ where: { id: aiVideoSecondsUsageEventId(held.id) } })).toBe(1);
    await runOpsHygiene(prisma, budgets, ages());
    expect(await prisma.usageEvent.count({ where: { id: aiVideoSecondsUsageEventId(held.id) } })).toBe(1);

    const open = await reserve("meter-open", `${laneId}-open`);
    await budgets.markUnreconciled(open.id, "GATEWAY_UNRECONCILED");
    await prisma.aiVideoBudgetReservation.update({
      where: { id: open.id },
      data: { actualBilledSeconds: 5 },
    });
    await runOpsHygiene(prisma, budgets, ages());
    expect(await prisma.usageEvent.count({ where: { id: aiVideoSecondsUsageEventId(open.id) } })).toBe(0);
  });

  it("releases a stale RESERVED hold with no attempt and keeps in-flight or young holds", async () => {
    const leaked = await reserve("leaked", `pr11-${userId}-leaked`);
    const young = await reserve("young", `pr11-${userId}-young`);
    const pendingSlot = await slotFor("pending-hold");
    const pendingHold = await reserve("pending-hold", `pr11-${userId}-pending`);
    const pendingAttempt = await records.beginAttempt({
      shotFulfillmentId: pendingSlot.id,
      laneClass: "draft-cost",
      laneId: `pr11-${userId}-pending`,
      providerKey: "open:pending",
      requiredScopes: pendingSlot.requiredScopes,
      budgetReservationId: pendingHold.id,
      jobId: "job-pending-pr11",
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    const running = await prisma.job.create({
      data: { projectId, type: "AI_ASSET", status: "RUNNING" },
    });
    const runningHold = await budgets.reserve({
      idempotencyKey: `asset:${running.id}:running:-:0`,
      projectId,
      userId,
      windowKey: "2026-09-30",
      laneId: `pr11-${userId}-running`,
      providerKey: "open:running",
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
      caps: {},
    });
    const old = new Date(Date.now() - 3 * HOUR);
    await prisma.aiVideoBudgetReservation.updateMany({
      where: { id: { in: [leaked.id, pendingHold.id, runningHold.id] } },
      data: { createdAt: old },
    });
    await runOpsHygiene(prisma, budgets, ages());
    const leakedRow = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: leaked.id } });
    const youngRow = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: young.id } });
    const pendingRow = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: pendingHold.id } });
    const runningRow = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: runningHold.id } });
    expect(leakedRow.status).toBe("RELEASED");
    expect(leakedRow.settleReason).toBe("STALE_RESERVED");
    expect(leakedRow.actualBilledSeconds).toBeNull();
    expect(leakedRow.actualUsd).toBeNull();
    expect(youngRow.status).toBe("RESERVED");
    expect(pendingRow.status).toBe("RESERVED");
    expect(pendingAttempt.outcome).toBe("PENDING");
    expect(runningRow.status).toBe("RESERVED");
    expect(await prisma.usageEvent.count({ where: { id: aiVideoSecondsUsageEventId(leaked.id) } })).toBe(0);
    await expect(
      runOpsHygiene(prisma, budgets, { ...ages(), staleReservedMinAgeMs: 1_000 }),
    ).rejects.toThrow(/SG_STALE_RESERVED_SWEEP_MIN_AGE_MS/);
    expect((await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: young.id } })).status).toBe(
      "RESERVED",
    );
  });

  it("flags gateway lane and model mismatches and an unresolved link", async () => {
    const matchLane = `pr11-${userId}-match`;
    const slot = await slotFor("flags");
    const matchedGateway = await prisma.gatewaySpendReservation.create({
      data: {
        ledgerIds: ["yf-asset"],
        laneId: matchLane,
        providerKey: "open:gw",
        capability: "VIDEO_GENERATION",
        modelId: "model-a",
        idempotencyKey: `pr11-${userId}-match-gw`,
        requestedDurationS: 5,
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.1,
        reservedUsd: 0.5,
        status: "RESERVED",
      },
    });
    const laneGateway = await prisma.gatewaySpendReservation.create({
      data: {
        ledgerIds: ["yf-asset"],
        laneId: `pr11-${userId}-other-lane`,
        providerKey: "open:gw",
        capability: "VIDEO_GENERATION",
        modelId: "model-a",
        idempotencyKey: `pr11-${userId}-lane-gw`,
        requestedDurationS: 5,
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.1,
        reservedUsd: 0.5,
        status: "RESERVED",
      },
    });
    const modelGateway = await prisma.gatewaySpendReservation.create({
      data: {
        ledgerIds: ["yf-asset"],
        laneId: matchLane,
        providerKey: "open:gw",
        capability: "VIDEO_GENERATION",
        modelId: "model-b",
        idempotencyKey: `pr11-${userId}-model-gw`,
        requestedDurationS: 5,
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.1,
        reservedUsd: 0.5,
        status: "RESERVED",
      },
    });
    const bothNull = await prisma.gatewaySpendReservation.create({
      data: {
        ledgerIds: ["yf-asset"],
        laneId: matchLane,
        providerKey: "open:gw",
        capability: "VIDEO_GENERATION",
        modelId: null,
        idempotencyKey: `pr11-${userId}-null-gw`,
        requestedDurationS: 5,
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.1,
        reservedUsd: 0.5,
        status: "RESERVED",
      },
    });
    const matched = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "draft-cost",
      laneId: matchLane,
      providerKey: "open:match",
      modelId: "model-a",
      requiredScopes: slot.requiredScopes,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    const laneMismatch = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "draft-cost",
      laneId: matchLane,
      providerKey: "open:lane",
      modelId: "model-a",
      requiredScopes: slot.requiredScopes,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    const modelMismatch = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "draft-cost",
      laneId: matchLane,
      providerKey: "open:model",
      modelId: "model-a",
      requiredScopes: slot.requiredScopes,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    const nullModel = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "draft-cost",
      laneId: matchLane,
      providerKey: "open:null",
      modelId: null,
      requiredScopes: slot.requiredScopes,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    const missing = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "draft-cost",
      laneId: matchLane,
      providerKey: "open:missing",
      modelId: "model-a",
      requiredScopes: slot.requiredScopes,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    await prisma.shotFulfillmentAttempt.update({
      where: { id: matched.id },
      data: { gatewayReservationId: matchedGateway.id },
    });
    await prisma.shotFulfillmentAttempt.update({
      where: { id: laneMismatch.id },
      data: { gatewayReservationId: laneGateway.id },
    });
    await prisma.shotFulfillmentAttempt.update({
      where: { id: modelMismatch.id },
      data: { gatewayReservationId: modelGateway.id },
    });
    await prisma.shotFulfillmentAttempt.update({
      where: { id: nullModel.id },
      data: { gatewayReservationId: bothNull.id },
    });
    await prisma.shotFulfillmentAttempt.update({
      where: { id: missing.id },
      data: { gatewayReservationId: `missing-${userId}` },
    });
    const flags = await readReconciliationFlags(prisma);
    const ids = new Set([matched.id, laneMismatch.id, modelMismatch.id, nullModel.id, missing.id]);
    const mine = flags.filter((flag) => ids.has(flag.attemptId));
    expect(mine.find((flag) => flag.attemptId === matched.id)).toBeUndefined();
    expect(mine.find((flag) => flag.attemptId === nullModel.id)).toBeUndefined();
    expect(mine.find((flag) => flag.attemptId === laneMismatch.id)).toMatchObject({
      kind: "MISMATCH",
      fields: ["laneId"],
    });
    expect(mine.find((flag) => flag.attemptId === modelMismatch.id)).toMatchObject({
      kind: "MISMATCH",
      fields: ["modelId"],
    });
    expect(mine.find((flag) => flag.attemptId === missing.id)).toMatchObject({
      kind: "UNRESOLVED_LINK",
      gatewayReservationId: `missing-${userId}`,
    });
    const laneRow = await prisma.shotFulfillmentAttempt.findUniqueOrThrow({ where: { id: laneMismatch.id } });
    expect(laneRow.laneId).toBe(matchLane);
  });

  it("shows open exposure outside the days window, including a hold with no attempt", async () => {
    const reservedLane = `pr11-${userId}-open-reserved`;
    const unreconciledLane = `pr11-${userId}-open-unreconciled`;
    const reserved = await reserve("open-reserved", reservedLane);
    const unreconciled = await reserve("open-unreconciled", unreconciledLane);
    await budgets.markUnreconciled(unreconciled.id, "GATEWAY_UNRECONCILED");
    await prisma.aiVideoBudgetReservation.update({
      where: { id: reserved.id },
      data: { createdAt: new Date(Date.now() - 100 * DAY) },
    });
    await prisma.aiVideoBudgetReservation.update({
      where: { id: unreconciled.id },
      data: {
        createdAt: new Date(Date.now() - 30 * DAY),
        settledAt: new Date(Date.now() - 30 * DAY),
      },
    });
    const exposure = await readOpenExposure(prisma);
    expect(exposure.find((row) => row.laneId === reservedLane)).toMatchObject({
      reservedHolds: 1,
      reservedUsd: 0.5,
      unreconciledHolds: 0,
    });
    expect(exposure.find((row) => row.laneId === unreconciledLane)).toMatchObject({
      unreconciledHolds: 1,
      unreconciledUsd: 0.5,
      reservedHolds: 0,
    });
    const window = await readLaneScopeDayRollups(prisma, 14);
    expect(window.rows.filter((row) => row.laneId === reservedLane)).toEqual([]);
    const previous = env.BETA_OPS_SECRET;
    (env as { BETA_OPS_SECRET?: string }).BETA_OPS_SECRET = "pr11-ops";
    try {
      const response = await lanesRoute(
        new Request("http://localhost/api/ops/sg/lanes?days=14", {
          headers: { authorization: "Bearer pr11-ops" },
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        days: number;
        openExposure: Array<{ laneId: string }>;
        reconciliationFlags: unknown[];
      };
      expect(body.days).toBe(14);
      expect(body.openExposure.some((row) => row.laneId === reservedLane)).toBe(true);
      expect(body.openExposure.some((row) => row.laneId === unreconciledLane)).toBe(true);
      expect(Array.isArray(body.reconciliationFlags)).toBe(true);
    } finally {
      (env as { BETA_OPS_SECRET?: string }).BETA_OPS_SECRET = previous;
    }

    const reservedOnly = buildLaneScopeDayRollups(
      [
        {
          laneId: "attempt",
          outcome: "PENDING",
          startedAt: new Date(),
          budgetReservationId: "h",
          scope: "HERO",
        },
      ],
      [
        {
          id: "h",
          laneId: "hold-lane",
          status: "RESERVED",
          estimatedBilledSeconds: 5,
          estimatedUsd: 0.5,
          actualBilledSeconds: null,
          actualUsd: null,
          settledAt: null,
          createdAt: new Date(),
        },
      ],
    );
    expect(reservedOnly[0]?.actualUsd).toBeNull();
    const unreconciledOnly = buildLaneScopeDayRollups(
      [
        {
          laneId: "attempt",
          outcome: "TIMEOUT_UNRECONCILED",
          startedAt: new Date(),
          budgetReservationId: "h2",
          scope: "HERO",
        },
      ],
      [
        {
          id: "h2",
          laneId: "hold-lane",
          status: "UNRECONCILED",
          estimatedBilledSeconds: 5,
          estimatedUsd: 0.5,
          actualBilledSeconds: null,
          actualUsd: null,
          settledAt: new Date(),
          createdAt: new Date(),
        },
      ],
    );
    expect(unreconciledOnly[0]?.actualUsd).toBeNull();
  });

  it("authorizes ops routes with a timing-safe compare and hides hygiene without the secret", async () => {
    expect(opsBearerAuthorized(null, undefined)).toBe(false);
    expect(opsBearerAuthorized("Bearer secret", undefined)).toBe(false);
    expect(opsBearerAuthorized("Bearer wrong", "secret")).toBe(false);
    expect(opsBearerAuthorized("Bearer secret", "secret")).toBe(true);
    expect(opsBearerAuthorized("Bearer secret-extra", "secret")).toBe(false);
    for (const file of [
      "src/app/api/ops/spend/route.ts",
      "src/app/api/ops/sg/lanes/route.ts",
      "src/app/api/ops/beta-invites/route.ts",
      "src/app/api/ops/sg/hygiene/route.ts",
    ]) {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("opsBearerAuthorized");
      expect(text).not.toMatch(/!==\s*`Bearer/);
      expect(text).not.toMatch(/===\s*`Bearer/);
    }
    const hygieneSource = readFileSync("src/server/sg/ops-hygiene.ts", "utf8");
    expect(hygieneSource).not.toMatch(/beginAttempt|\.generate\s*\(/);
    expect(hygieneSource).not.toMatch(/attempt\.actualUsd/);
    const rollup = readFileSync("src/server/sg/lane-meter-rollup.ts", "utf8");
    const exposure = rollup.slice(rollup.indexOf("export async function readOpenExposure"));
    expect(exposure).not.toMatch(/shot_fulfillment_attempt|shotFulfillmentAttempt/);
    expect(exposure).not.toMatch(/startedAt/);

    const previous = env.BETA_OPS_SECRET;
    const previousAge = process.env.SG_UNRECONCILED_SWEEP_MIN_AGE_MS;
    try {
      (env as { BETA_OPS_SECRET?: string }).BETA_OPS_SECRET = "pr11-ops";
      const missing = await hygieneRoute(new Request("http://localhost/api/ops/sg/hygiene", { method: "POST" }));
      expect(missing.status).toBe(404);
      const wrong = await inviteRoute(
        new Request("http://localhost/api/ops/beta-invites", {
          method: "POST",
          headers: { authorization: "Bearer nope" },
          body: "{}",
        }),
      );
      expect(wrong.status).toBe(404);
      process.env.SG_UNRECONCILED_SWEEP_MIN_AGE_MS = "1";
      const rejected = await hygieneRoute(
        new Request("http://localhost/api/ops/sg/hygiene", {
          method: "POST",
          headers: { authorization: "Bearer pr11-ops" },
        }),
      );
      expect(rejected.status).toBe(400);
    } finally {
      (env as { BETA_OPS_SECRET?: string }).BETA_OPS_SECRET = previous;
      if (previousAge === undefined) delete process.env.SG_UNRECONCILED_SWEEP_MIN_AGE_MS;
      else process.env.SG_UNRECONCILED_SWEEP_MIN_AGE_MS = previousAge;
    }
  });
});
