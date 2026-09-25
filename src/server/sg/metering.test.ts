import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GET as lanesRoute } from "@/app/api/ops/sg/lanes/route";
import { GET as spendRoute } from "@/app/api/ops/spend/route";
import { env } from "@/lib/env";
import { prisma } from "@/server/db";
import { PrismaAiVideoBudget } from "@/server/sg/ai-video-budget";
import { buildLaneScopeDayRollups, readLaneScopeDayRollups } from "@/server/sg/lane-meter-rollup";
import { requireLaneRate, requireLiveLane } from "@/server/sg/lane-rate";
import {
  aiVideoSecondsUsageEventId,
  meterableBilledSeconds,
  recordSettledAiVideoSeconds,
} from "@/server/sg/metering";
import { PrismaShotFulfillment } from "@/server/sg/shot-fulfillment";
import { UsageKind } from "@/server/usage/types";
import { ProjectService } from "@/server/services/projects";

describe("lane scope day rollup", () => {
  it("shows an UNRECONCILED hold as exposure when the slot would be FAILED", () => {
    const rows = buildLaneScopeDayRollups(
      [
        {
          laneId: "attempt-lane-ignored",
          outcome: "TIMEOUT_UNRECONCILED",
          startedAt: new Date("2026-09-25T12:00:00Z"),
          budgetReservationId: "hold_1",
          scope: "HERO",
        },
      ],
      [
        {
          id: "hold_1",
          laneId: "r1-wan27-replicate",
          status: "UNRECONCILED",
          estimatedBilledSeconds: 5,
          estimatedUsd: 0.5,
          actualBilledSeconds: null,
          actualUsd: null,
          settledAt: new Date("2026-09-25T12:05:00Z"),
          createdAt: new Date("2026-09-25T12:00:00Z"),
        },
      ],
    );
    expect(rows).toEqual([
      {
        laneId: "r1-wan27-replicate",
        scope: "HERO",
        day: "2026-09-25",
        attempts: 1,
        billedSeconds: 0,
        estimatedUsd: 0.5,
        actualUsd: null,
        unreconciledBilledSeconds: 5,
        unreconciledUsd: 0.5,
        reservedBilledSeconds: 0,
        reservedUsd: 0,
        outcomes: { TIMEOUT_UNRECONCILED: 1 },
      },
    ]);
  });

  it("does not meter a release, a zero-second reconcile, or an open hold", () => {
    expect(
      meterableBilledSeconds({
        id: "h",
        userId: "u",
        projectId: "p",
        providerKey: "open:x",
        status: "RELEASED",
        settleReason: "CAP_DENIED",
        actualBilledSeconds: null,
      }),
    ).toBeNull();
    expect(
      meterableBilledSeconds({
        id: "h",
        userId: "u",
        projectId: "p",
        providerKey: "open:x",
        status: "UNRECONCILED",
        settleReason: "GATEWAY_UNRECONCILED",
        actualBilledSeconds: null,
      }),
    ).toBeNull();
    expect(
      meterableBilledSeconds({
        id: "h",
        userId: "u",
        projectId: "p",
        providerKey: "open:x",
        status: "RECONCILED",
        settleReason: "SUCCEEDED",
        actualBilledSeconds: 0,
      }),
    ).toBeNull();
    expect(
      meterableBilledSeconds({
        id: "h",
        userId: "u",
        projectId: "p",
        providerKey: "open:x",
        status: "RECONCILED",
        settleReason: "GATEWAY_RECONCILED",
        actualBilledSeconds: 5,
      }),
    ).toBe(5);
  });
});

describe("SG PR-5 per-shot metering", () => {
  const userId = `sg-pr5-${Date.now()}`;
  const projects = new ProjectService();
  const budgets = new PrismaAiVideoBudget(prisma);
  const records = new PrismaShotFulfillment(prisma);
  const opsSecret = "pr5-ops-secret";
  let projectId = "";
  let dir = "";

  afterAll(async () => {
    await prisma.usageEvent.deleteMany({ where: { userId } });
    if (projectId) {
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId }] },
      });
      await prisma.gatewaySpendLedger.deleteMany({ where: { id: { startsWith: `lane:pr5-${userId}` } } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function readyProject() {
    if (projectId) return projectId;
    await prisma.user.create({
      data: { id: userId, name: "Meter", email: `${userId}@example.com`, emailVerified: true },
    });
    const project = await projects.create(userId, { title: "Meter", logline: "SG.2" });
    projectId = project.id;
    return projectId;
  }

  async function openHold(label: string, laneId: string) {
    const project = await readyProject();
    const slot = await records.ensureSlot({
      projectId: project,
      timelineId: "tl-pr5",
      timelineVersion: 1,
      role: label,
    });
    const held = await budgets.reserve({
      idempotencyKey: `${userId}-${label}`,
      projectId: project,
      userId,
      windowKey: "2026-09-25",
      laneId,
      providerKey: `open:${label}`,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
      caps: {},
    });
    const attempt = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "standard",
      laneId,
      providerKey: "attempt-must-not-win",
      requiredScopes: slot.requiredScopes,
      budgetReservationId: held.id,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.99,
      estimatedUsd: 9.99,
    });
    return { slot, held, attempt };
  }

  async function countMeter(reservationId: string) {
    return prisma.usageEvent.count({
      where: { id: aiVideoSecondsUsageEventId(reservationId), kind: UsageKind.AI_VIDEO_SECONDS },
    });
  }

  it("traces attempt to reservation to one usage event and keeps a FAILED slot's unreconciled exposure", async () => {
    const laneId = `pr5-${userId}-chain`;
    const { slot, held, attempt } = await openHold("chain", laneId);
    await prisma.shotFulfillment.update({ where: { id: slot.id }, data: { scope: "HERO" } });
    await prisma.shotFulfillmentAttempt.update({
      where: { id: attempt.id },
      data: { actualBilledSeconds: 0, actualUsd: 0, providerKey: "attempt-must-not-win" },
    });

    await budgets.markUnreconciled(held.id, "GATEWAY_UNRECONCILED");
    await records.finishAttempt({
      attemptId: attempt.id,
      outcome: "TIMEOUT_UNRECONCILED",
      failureCode: "TIMEOUT",
    });
    const failedSlot = await prisma.shotFulfillment.findUniqueOrThrow({ where: { id: slot.id } });
    expect(failedSlot.status).toBe("FAILED");
    expect(await countMeter(held.id)).toBe(0);

    const exposed = (await readLaneScopeDayRollups(prisma)).find((row) => row.laneId === laneId);
    expect(exposed).toMatchObject({
      scope: "HERO",
      attempts: 1,
      billedSeconds: 0,
      estimatedUsd: 0.5,
      actualUsd: null,
      unreconciledBilledSeconds: 5,
      unreconciledUsd: 0.5,
      outcomes: { TIMEOUT_UNRECONCILED: 1 },
    });

    const settled = await budgets.reconcile(held.id, { actualBilledSeconds: 6, reason: "SUCCEEDED" });
    expect(settled.actualBilledSeconds).toBe(6);
    expect(settled.actualUsd).toBeCloseTo(0.6, 5);
    await budgets.reconcile(held.id, { actualBilledSeconds: 9, reason: "POLL_RETRY" });
    await Promise.all([
      recordSettledAiVideoSeconds(settled),
      recordSettledAiVideoSeconds({ ...settled, actualBilledSeconds: 9, settleReason: "WEBHOOK" }),
    ]);

    expect(await countMeter(held.id)).toBe(1);
    const usage = await prisma.usageEvent.findUniqueOrThrow({
      where: { id: aiVideoSecondsUsageEventId(held.id) },
      include: { engineCosts: true },
    });
    const reservation = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: held.id } });
    const linked = await prisma.shotFulfillmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(linked.budgetReservationId).toBe(reservation.id);
    expect(linked.attemptNo).toBe(1);
    expect(usage.id).toBe(`sg:${UsageKind.AI_VIDEO_SECONDS}:${reservation.id}`);
    expect(usage.id).not.toContain(`attemptNo`);
    expect(usage.kind).toBe(UsageKind.AI_VIDEO_SECONDS);
    expect(usage.quantity).toBe(reservation.actualBilledSeconds);
    expect(usage.quantity).toBe(6);
    expect(usage.outcome).toBe("SUCCEEDED");
    expect(usage.engineCosts).toHaveLength(1);
    expect(usage.engineCosts[0]).toMatchObject({
      providerKey: reservation.providerKey,
      capability: "VIDEO_GENERATION",
      costUnits: reservation.actualBilledSeconds,
      costKind: "ESTIMATED",
    });
    expect(usage.engineCosts[0]?.providerKey).toBe("open:chain");
    expect(usage.engineCosts[0]?.providerKey).not.toBe(linked.providerKey);
    expect(await prisma.usageEvent.count({ where: { userId, kind: UsageKind.ASSET_CALL } })).toBe(0);

    const traced = (await readLaneScopeDayRollups(prisma)).find((row) => row.laneId === laneId);
    expect(traced).toMatchObject({
      scope: "HERO",
      billedSeconds: 6,
      estimatedUsd: 0.5,
      actualUsd: 0.6,
      unreconciledBilledSeconds: 0,
      unreconciledUsd: 0,
    });
    expect(traced?.actualUsd).not.toBe(0);
  });

  it("emits one event across a reconcile race and skips CAP_DENIED and non-billable release", async () => {
    const laneId = `pr5-${userId}-race`;
    const { held } = await openHold("race", laneId);
    const [first, second] = await Promise.all([
      budgets.reconcile(held.id, { actualBilledSeconds: 5, reason: "SUCCEEDED" }),
      budgets.reconcile(held.id, { actualBilledSeconds: 8, reason: "WEBHOOK" }),
    ]);
    expect(first.status).toBe("RECONCILED");
    expect(second.status).toBe("RECONCILED");
    const reservation = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: held.id } });
    expect(await countMeter(held.id)).toBe(1);
    const usage = await prisma.usageEvent.findUniqueOrThrow({
      where: { id: aiVideoSecondsUsageEventId(held.id) },
      include: { engineCosts: true },
    });
    expect(usage.quantity).toBe(reservation.actualBilledSeconds);
    expect(usage.engineCosts).toHaveLength(1);
    expect(usage.quantity === 5 || usage.quantity === 8).toBe(true);

    const denied = await openHold("denied", `pr5-${userId}-denied`);
    await budgets.release(denied.held.id, "CAP_DENIED");
    await records.finishAttempt({
      attemptId: denied.attempt.id,
      outcome: "CAP_DENIED",
      failureCode: "CAP_DENIED",
    });
    expect(await countMeter(denied.held.id)).toBe(0);

    const released = await openHold("released", `pr5-${userId}-released`);
    await budgets.release(released.held.id, "GATEWAY_RELEASED");
    expect(await countMeter(released.held.id)).toBe(0);

    const zero = await openHold("zero", `pr5-${userId}-zero`);
    await budgets.reconcile(zero.held.id, { actualBilledSeconds: 0, reason: "SUCCEEDED" });
    expect(await countMeter(zero.held.id)).toBe(0);

    const billedFailure = await openHold("billed-failure", `pr5-${userId}-billed`);
    await budgets.reconcile(billedFailure.held.id, {
      actualBilledSeconds: 5,
      reason: "GATEWAY_RECONCILED",
    });
    await budgets.reconcile(billedFailure.held.id, {
      actualBilledSeconds: 5,
      reason: "GATEWAY_RECONCILED",
    });
    const failureEvent = await prisma.usageEvent.findUniqueOrThrow({
      where: { id: aiVideoSecondsUsageEventId(billedFailure.held.id) },
    });
    expect(failureEvent.outcome).toBe("GATEWAY_RECONCILED");
    expect(failureEvent.quantity).toBe(5);
    expect(await countMeter(billedFailure.held.id)).toBe(1);
  });

  it("meters a hold after the lane is disabled, using requireLaneRate rather than requireLiveLane", async () => {
    dir = dir || (await mkdtemp(path.join(tmpdir(), "youflicks-pr5-meter-")));
    const laneId = "probe-live";
    const file = path.join(dir, "live.json");
    const registry = {
      registryVersion: "sg-lanes-v1",
      thresholdsVersion: "po-sg-2026-09-25",
      regenCeilings: { "draft-cost": 3, "draft-quality": 2, standard: 2, premium: 2 },
      classOrder: ["draft-cost", "draft-quality", "standard", "premium"],
      processors: [],
      lanes: [
        {
          laneId,
          laneClass: "standard",
          providerKey: "open:probe-live",
          modelId: "open-probe",
          gateway: { baseUrlEnv: "SG_LANE_PROBE_BASE_URL", apiKeyEnv: "SG_LANE_PROBE_API_KEY" },
          resolutionTier: "720p",
          usdPerSecond: 0.1,
          rateRef: "fixture",
          clipDurationS: 5,
          supportedDurationsS: [5],
          billingGranularityS: 1,
          failuresBillable: true,
          audioMode: "OFF",
          enabled: true,
          designation: "NONE",
          gates: {
            HERO: { status: "NOT_QUALIFIED" },
            IDENTITY: { status: "NOT_QUALIFIED" },
            NON_IDENTITY: { status: "NOT_QUALIFIED" },
          },
        },
      ],
    };
    await writeFile(file, JSON.stringify(registry), "utf8");
    const previous = process.env.SG_LANE_REGISTRY_PATH;
    process.env.SG_LANE_REGISTRY_PATH = file;
    try {
      expect(requireLiveLane(laneId, file).usdPerSecond).toBe(0.1);
      const { held } = await openHold("disabled-midflight", laneId);
      const disabled = structuredClone(registry);
      disabled.lanes[0]!.enabled = false;
      await writeFile(file, JSON.stringify(disabled), "utf8");
      expect(() => requireLiveLane(laneId, file)).toThrow(/disabled/);
      expect(requireLaneRate(laneId, file).usdPerSecond).toBe(0.1);
      const settled = await budgets.reconcile(held.id, { actualBilledSeconds: 5, reason: "SUCCEEDED" });
      expect(settled.actualBilledSeconds).toBe(5);
      expect(await countMeter(held.id)).toBe(1);
      const meterSource = readFileSync(path.join(process.cwd(), "src/server/sg/metering.ts"), "utf8");
      const budgetSource = readFileSync(path.join(process.cwd(), "src/server/sg/ai-video-budget.ts"), "utf8");
      expect(meterSource).not.toMatch(/requireLiveLane/);
      expect(budgetSource).not.toMatch(/requireLiveLane/);
    } finally {
      if (previous === undefined) delete process.env.SG_LANE_REGISTRY_PATH;
      else process.env.SG_LANE_REGISTRY_PATH = previous;
    }
  });

  it("returns 404 from both ops routes without the secret and adds lane and budget rows", async () => {
    const previous = env.BETA_OPS_SECRET;
    const laneLedgerId = `lane:pr5-${userId}-ops`;
    try {
      (env as { BETA_OPS_SECRET?: string }).BETA_OPS_SECRET = undefined;
      const spendMissing = await spendRoute(new Request("http://localhost/api/ops/spend"));
      const lanesMissing = await lanesRoute(new Request("http://localhost/api/ops/sg/lanes"));
      expect(spendMissing.status).toBe(404);
      expect(lanesMissing.status).toBe(404);

      (env as { BETA_OPS_SECRET?: string }).BETA_OPS_SECRET = opsSecret;
      const spendWrong = await spendRoute(
        new Request("http://localhost/api/ops/spend", { headers: { authorization: "Bearer wrong" } }),
      );
      const lanesWrong = await lanesRoute(
        new Request("http://localhost/api/ops/sg/lanes", { headers: { authorization: "Bearer wrong" } }),
      );
      expect(spendWrong.status).toBe(404);
      expect(lanesWrong.status).toBe(404);

      await openHold("ops", `pr5-${userId}-ops-budget`);
      await prisma.gatewaySpendLedger.upsert({
        where: { id: laneLedgerId },
        create: {
          id: laneLedgerId,
          scopeKind: "LANE",
          reservedUsd: 1.25,
          reservedSeconds: 5,
        },
        update: { reservedUsd: 1.25, reservedSeconds: 5, scopeKind: "LANE" },
      });
      const spend = await spendRoute(
        new Request("http://localhost/api/ops/spend", {
          headers: { authorization: `Bearer ${opsSecret}` },
        }),
      );
      expect(spend.status).toBe(200);
      const body = (await spend.json()) as {
        ledgerId: string;
        jobsAccepted: number;
        lanes: Array<{ ledgerId: string; reservedUsd: number; scopeKind: string }>;
        budgetLedgers: Array<{ id: string; projectId: string | null; reservedUsd: number }>;
      };
      expect(body.ledgerId).toBe("yf-asset");
      expect(typeof body.jobsAccepted).toBe("number");
      const lane = body.lanes.find((row) => row.ledgerId === laneLedgerId);
      expect(lane).toMatchObject({ scopeKind: "LANE", reservedUsd: 1.25 });
      expect(body.budgetLedgers.some((row) => row.projectId === projectId)).toBe(true);
      expect(body).not.toHaveProperty("creativePlan");

      const lanes = await lanesRoute(
        new Request("http://localhost/api/ops/sg/lanes", {
          headers: { authorization: `Bearer ${opsSecret}` },
        }),
      );
      expect(lanes.status).toBe(200);
      const lanesBody = (await lanes.json()) as { rows: Array<{ laneId: string }> };
      expect(Array.isArray(lanesBody.rows)).toBe(true);
    } finally {
      (env as { BETA_OPS_SECRET?: string }).BETA_OPS_SECRET = previous;
      await prisma.gatewaySpendLedger.deleteMany({ where: { id: laneLedgerId } });
    }
  });
});
