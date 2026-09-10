import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobType } from "@/server/domain/status";
import { prisma } from "@/server/db";
import { UsageMeterService } from "@/server/services/usage-meter";
import {
  estimateEngineCostUnits,
  OPS_COST_UNITS_PER_QUANTITY,
} from "@/server/usage/cost-table";
import { EngineCostKind, UsageKind, UsageOutcome } from "@/server/usage/types";

describe("UsageMeterService M8.3 ops metering", () => {
  const userId = `m83-user-${Date.now()}`;
  const otherId = `m83-other-${Date.now()}`;
  const missingId = `m83-missing-${Date.now()}`;
  const meter = new UsageMeterService();
  let projectId = "";

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: userId, name: "Meter", email: `${userId}@example.com`, emailVerified: true },
        { id: otherId, name: "Other", email: `${otherId}@example.com`, emailVerified: true },
      ],
    });
    const project = await prisma.project.create({
      data: { ownerId: userId, title: "Usage meter", status: "DRAFT" },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.engineCostEvent.deleteMany({
      where: { usageEvent: { userId: { in: [userId, otherId] } } },
    });
    await prisma.usageEvent.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("appends UsageEvent + EngineCostEvent for open-string kinds", async () => {
    const recorded = await meter.record({
      userId,
      projectId,
      jobId: "job_direct_1",
      kind: UsageKind.MOVIE_GENERATION,
      quantity: 1,
      engineCost: {
        providerKey: "youflicks.local.director",
        capability: "STORY_REASONING",
        costUnits: 100,
      },
    });
    expect(recorded).toMatchObject({
      userId,
      projectId,
      jobId: "job_direct_1",
      kind: "MOVIE_GENERATION",
      quantity: 1,
      outcome: "SUCCEEDED",
    });
    expect(recorded.engineCosts).toHaveLength(1);
    expect(recorded.engineCosts[0]).toMatchObject({
      providerKey: "youflicks.local.director",
      capability: "STORY_REASONING",
      costUnits: 100,
      costKind: EngineCostKind.ESTIMATED,
      jobId: "job_direct_1",
    });

    const listed = await meter.listForUser(userId, { kind: UsageKind.MOVIE_GENERATION });
    expect(listed.some((event) => event.id === recorded.id)).toBe(true);
    const byJob = await meter.listForJob("job_direct_1");
    expect(byJob).toHaveLength(1);
  });

  it("accepts additional open-string kinds without a Prisma enum", async () => {
    const recorded = await meter.record({
      userId,
      kind: "CUSTOM_OPS_PROBE",
      quantity: 2.5,
      outcome: UsageOutcome.FAILED,
    });
    expect(recorded.kind).toBe("CUSTOM_OPS_PROBE");
    expect(recorded.quantity).toBe(2.5);
    expect(recorded.outcome).toBe("FAILED");
    expect(recorded.engineCosts).toEqual([]);
  });

  it("recordJobUsage estimates ops units and never throws on a missing user", async () => {
    const ok = await meter.recordJobUsage({
      userId,
      projectId,
      jobId: "job_asset_1",
      kind: UsageKind.ASSET_CALL,
      quantity: 1,
      providerKey: "youflicks.local.asset",
      capability: "IMAGE_GENERATION",
    });
    expect(ok?.engineCosts[0]?.costUnits).toBe(estimateEngineCostUnits(UsageKind.ASSET_CALL, 1));
    expect(ok?.engineCosts[0]?.costUnits).toBe(OPS_COST_UNITS_PER_QUANTITY.ASSET_CALL);

    const missing = await meter.recordJobUsage({
      userId: missingId,
      kind: UsageKind.MOVIE_GENERATION,
      quantity: 1,
      providerKey: "none",
      capability: "STORY_REASONING",
    });
    expect(missing).toBeNull();
  });

  it("does not write CreativePlan / Story / Timeline / billing rows", async () => {
    const plansBefore = await prisma.creativePlan.count({ where: { projectId } });
    const storiesBefore = await prisma.storyStructure.count({ where: { projectId } });
    const timelinesBefore = await prisma.timeline.count({ where: { projectId } });
    await meter.record({
      userId,
      projectId,
      kind: UsageKind.RENDER_SECONDS,
      quantity: 3,
      engineCost: {
        providerKey: "youflicks.local.renderer",
        capability: "VIDEO_RENDER",
        costUnits: 3,
        costKind: EngineCostKind.ACTUAL,
      },
    });
    expect(await prisma.creativePlan.count({ where: { projectId } })).toBe(plansBefore);
    expect(await prisma.storyStructure.count({ where: { projectId } })).toBe(storiesBefore);
    expect(await prisma.timeline.count({ where: { projectId } })).toBe(timelinesBefore);
    expect(await prisma.subscription.count({ where: { userId } })).toBe(0);
    expect(await prisma.creditLedger.count({ where: { userId } })).toBe(0);
    expect(prisma).not.toHaveProperty("invoice");
    expect(prisma).not.toHaveProperty("billing");
    expect("AI_BILL" in JobType).toBe(false);
    expect("AI_ADS" in JobType).toBe(false);
    expect("AI_ENTITLEMENT" in JobType).toBe(false);
  });

  it("does not leak another user's usage and stays off CreativePlan JSON", async () => {
    await meter.record({
      userId: otherId,
      kind: UsageKind.MOVIE_GENERATION,
      quantity: 1,
      engineCost: {
        providerKey: "other.director",
        capability: "STORY_REASONING",
        costUnits: 100,
      },
    });
    const mine = await meter.listForUser(userId);
    expect(mine.every((event) => event.userId === userId)).toBe(true);
    expect(mine.some((event) => event.engineCosts[0]?.providerKey === "other.director")).toBe(
      false,
    );
    expect(JSON.stringify(mine)).not.toMatch(/CreativePlan|StoryDocument|Timeline|stripe/i);
  });

  it("keeps GenerationAuthorization as the free-tier meter", async () => {
    const authBefore = await prisma.generationAuthorization.count({ where: { userId } });
    await meter.record({
      userId,
      kind: UsageKind.MOVIE_GENERATION,
      quantity: 1,
    });
    expect(await prisma.generationAuthorization.count({ where: { userId } })).toBe(authBefore);
  });

  it("cost table changes only affect EngineCostEvent units", async () => {
    const cheap = new UsageMeterService(() => 1);
    const expensive = new UsageMeterService(() => 50_000);
    const a = await cheap.recordJobUsage({
      userId,
      kind: UsageKind.MOVIE_GENERATION,
      quantity: 1,
      providerKey: "ops.a",
      capability: "STORY_REASONING",
    });
    const b = await expensive.recordJobUsage({
      userId,
      kind: UsageKind.MOVIE_GENERATION,
      quantity: 1,
      providerKey: "ops.b",
      capability: "STORY_REASONING",
    });
    expect(a?.kind).toBe(b?.kind);
    expect(a?.quantity).toBe(b?.quantity);
    expect(a?.engineCosts[0]?.costUnits).toBe(1);
    expect(b?.engineCosts[0]?.costUnits).toBe(50_000);
  });
});
