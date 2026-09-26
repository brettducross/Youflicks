import { afterAll, describe, expect, it } from "vitest";
import { GET as spendRoute } from "@/app/api/ops/spend/route";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { prisma } from "@/server/db";
import { env } from "@/lib/env";
import { GATEWAY_SPEND_LEDGER_ID } from "@/server/beta/defaults";
import { AiVideoBudgetSource, projectBudgetLedgerId, userWindowBudgetLedgerId } from "@/server/sg/budget-source";
import {
  AiVideoBudgetCapError,
  PrismaAiVideoBudget,
} from "@/server/sg/ai-video-budget";
import { estimateLaneCharge, requireLaneRate } from "@/server/sg/lane-rate";
import { ProjectService } from "@/server/services/projects";
import { WipeService } from "@/server/services/wipe";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const wan = requireLaneRate("r1-wan27-replicate");
const charge = estimateLaneCharge(wan);

describe("AiVideoBudgetSource", () => {
  it("returns ops caps and leaves unset scopes unenforced", () => {
    const resolved = AiVideoBudgetSource.resolve("user_1", "project_1", {}, new Date("2026-09-25T23:30:00Z"));
    expect(resolved.windowKey).toBe("2026-09-25");
    expect(resolved.caps).toEqual({});
    const capped = AiVideoBudgetSource.resolve(
      "user_1",
      "project_1",
      {
        SG_BUDGET_PROJECT_MAX_SECONDS: "30",
        SG_BUDGET_USER_WINDOW_MAX_USD: "4",
      },
      new Date("2026-09-25T00:30:00Z"),
    );
    expect(capped.caps.projectMaxSeconds).toBe(30);
    expect(capped.caps.userWindowMaxUsd).toBe(4);
    expect(capped.caps.projectMaxUsd).toBeUndefined();
    expect(() =>
      AiVideoBudgetSource.resolve("user_1", "project_1", { SG_BUDGET_PROJECT_MAX_USD: "0" }),
    ).toThrow(/SG_BUDGET_PROJECT_MAX_USD/);
  });
});

describe("AiVideoBudgetLedger caps, seconds, and deletion", () => {
  const userId = `sg-budget-${Date.now()}`;
  const projects = new ProjectService();
  let projectId = "";
  let dir = "";

  afterAll(async () => {
    await prisma.aiVideoBudgetLedger.deleteMany({
      where: { OR: [{ userId }, { projectId: projectId || "none" }] },
    });
    if (projectId) {
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("enforces project and user seconds and dollar caps, then purges ledgers on delete", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-sg-budget-"));
    await prisma.user.create({
      data: { id: userId, name: "Budget", email: `${userId}@example.com`, emailVerified: true },
    });
    const project = await projects.create(userId, { title: "Budget", logline: "SG.2" });
    projectId = project.id;
    const budgets = new PrismaAiVideoBudget(prisma);
    const windowKey = "2026-09-25";

    await expect(
      budgets.reserve({
        idempotencyKey: `${userId}-seconds`,
        projectId,
        userId,
        windowKey,
        laneId: wan.laneId,
        providerKey: wan.providerKey,
        estimatedBilledSeconds: charge.estimatedBilledSeconds,
        usdPerSecond: wan.usdPerSecond,
        estimatedUsd: charge.reservedUsd,
        caps: { projectMaxSeconds: 1 },
      }),
    ).rejects.toBeInstanceOf(AiVideoBudgetCapError);

    await expect(
      budgets.reserve({
        idempotencyKey: `${userId}-user-usd`,
        projectId,
        userId,
        windowKey,
        laneId: wan.laneId,
        providerKey: wan.providerKey,
        estimatedBilledSeconds: charge.estimatedBilledSeconds,
        usdPerSecond: wan.usdPerSecond,
        estimatedUsd: charge.reservedUsd,
        caps: { userWindowMaxUsd: 0.01 },
      }),
    ).rejects.toBeInstanceOf(AiVideoBudgetCapError);

    const held = await budgets.reserve({
      idempotencyKey: `${userId}-ok`,
      projectId,
      userId,
      windowKey,
      laneId: wan.laneId,
      providerKey: wan.providerKey,
      estimatedBilledSeconds: charge.estimatedBilledSeconds,
      usdPerSecond: wan.usdPerSecond,
      estimatedUsd: charge.reservedUsd,
      caps: { projectMaxSeconds: 30, projectMaxUsd: 10, userWindowMaxSeconds: 30, userWindowMaxUsd: 10 },
    });
    expect(held.status).toBe("RESERVED");
    expect(held.providerKey).toBe(wan.providerKey);
    expect(held.estimatedBilledSeconds).toBe(5);
    const projectLedger = await budgets.snapshot(projectBudgetLedgerId(projectId));
    const userLedger = await budgets.snapshot(userWindowBudgetLedgerId(userId, windowKey));
    expect(projectLedger?.reservedSeconds).toBeCloseTo(5, 5);
    expect(projectLedger?.reservedUsd).toBeCloseTo(charge.reservedUsd, 5);
    expect(userLedger?.scopeKind).toBe("USER_WINDOW");
    expect(userLedger?.reservedSeconds).toBeCloseTo(5, 5);

    const again = await budgets.reserve({
      idempotencyKey: `${userId}-ok`,
      projectId,
      userId,
      windowKey,
      laneId: wan.laneId,
      providerKey: wan.providerKey,
      estimatedBilledSeconds: charge.estimatedBilledSeconds,
      usdPerSecond: wan.usdPerSecond,
      estimatedUsd: charge.reservedUsd,
      caps: {},
    });
    expect(again.id).toBe(held.id);
    expect((await budgets.snapshot(projectBudgetLedgerId(projectId)))?.attempts).toBe(1);

    await budgets.reconcile(held.id, { actualBilledSeconds: 5, reason: "SUCCEEDED" });
    const committed = await budgets.snapshot(projectBudgetLedgerId(projectId));
    expect(committed?.reservedSeconds).toBeCloseTo(0, 5);
    expect(committed?.committedSeconds).toBeCloseTo(5, 5);

    const wipe = new WipeService(new LocalStorageAdapter(dir));
    await wipe.deleteAccount(userId);
    expect(await prisma.aiVideoBudgetLedger.count({ where: { userId } })).toBe(0);
    expect(await prisma.aiVideoBudgetLedger.count({ where: { projectId } })).toBe(0);
    expect(await prisma.aiVideoBudgetReservation.count({ where: { projectId } })).toBe(0);
    projectId = "";
  });

  it("cascades project reservations and purges the project ledger on project delete", async () => {
    const owner = `${userId}-project`;
    await prisma.user.create({
      data: { id: owner, name: "Owner", email: `${owner}@example.com`, emailVerified: true },
    });
    const project = await projects.create(owner, { title: "Cascade", logline: "SG.2" });
    const budgets = new PrismaAiVideoBudget(prisma);
    await budgets.reserve({
      idempotencyKey: `${owner}-hold`,
      projectId: project.id,
      userId: owner,
      windowKey: "2026-09-25",
      laneId: wan.laneId,
      providerKey: wan.providerKey,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
      caps: {},
    });
    const wipe = new WipeService(new LocalStorageAdapter(dir || (await mkdtemp(path.join(tmpdir(), "youflicks-sg-budget-")))));
    await wipe.deleteProject(owner, project.id);
    expect(await prisma.aiVideoBudgetReservation.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.aiVideoBudgetLedger.count({ where: { projectId: project.id } })).toBe(0);
    const userLedger = await prisma.aiVideoBudgetLedger.findUnique({
      where: { id: userWindowBudgetLedgerId(owner, "2026-09-25") },
    });
    expect(userLedger?.userId).toBe(owner);
    await prisma.aiVideoBudgetLedger.deleteMany({ where: { userId: owner } });
    await prisma.user.delete({ where: { id: owner } });
  });
});

describe("GET /api/ops/spend", () => {
  const opsSecret = "test-ops-secret";

  function setOpsSecret(value: string | undefined) {
    (env as { BETA_OPS_SECRET?: string }).BETA_OPS_SECRET = value;
  }

  it("returns 404 when the ops secret is unset or the header does not match", async () => {
    const previous = env.BETA_OPS_SECRET;
    try {
      setOpsSecret(undefined);
      const unset = await spendRoute(
        new Request("http://localhost/api/ops/spend", {
          headers: { authorization: `Bearer ${opsSecret}` },
        }),
      );
      expect(unset.status).toBe(404);

      setOpsSecret(opsSecret);
      const missing = await spendRoute(new Request("http://localhost/api/ops/spend"));
      expect(missing.status).toBe(404);
      const wrong = await spendRoute(
        new Request("http://localhost/api/ops/spend", {
          headers: { authorization: "Bearer wrong" },
        }),
      );
      expect(wrong.status).toBe(404);
    } finally {
      setOpsSecret(previous);
    }
  });

  it("returns the global row with additive fields only", async () => {
    const previous = env.BETA_OPS_SECRET;
    setOpsSecret(opsSecret);
    try {
      const response = await spendRoute(
        new Request("http://localhost/api/ops/spend", {
          headers: { authorization: `Bearer ${opsSecret}` },
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.ledgerId).toBe(GATEWAY_SPEND_LEDGER_ID);
      expect(body).toMatchObject({
        jobsAccepted: expect.any(Number),
        spendUsd: expect.any(Number),
        reservedUsd: expect.any(Number),
        billedSeconds: expect.any(Number),
        reservedSeconds: expect.any(Number),
        scopeKind: expect.any(String),
      });
      expect(body).not.toHaveProperty("creativePlan");
      expect(Array.isArray(body.lanes)).toBe(true);
      expect(Array.isArray(body.budgetLedgers)).toBe(true);
    } finally {
      setOpsSecret(previous);
    }
  });
});
