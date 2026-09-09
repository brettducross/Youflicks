import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobType } from "@/server/domain/status";
import { prisma } from "@/server/db";
import {
  EmptyPrepaidResolver,
  EmptySubscriptionResolver,
} from "@/server/entitlement/resolvers";
import {
  EntitlementDenyCode,
  FREE_MAX_OUTPUT_DURATION_MS,
  FREE_MOVIE_GENERATIONS_PER_HOUR,
  MeterKind,
  PlanKind,
} from "@/server/entitlement/types";
import { AccountLifecycleService } from "@/server/services/account-lifecycle";
import { EntitlementService, mergeSnapshot } from "@/server/services/entitlement";
import { IntentService } from "@/server/services/intent";
import { ProjectService } from "@/server/services/projects";

describe("EntitlementService M8.2 free-tier gate", () => {
  const verifiedId = `m82-verified-${Date.now()}`;
  const unverifiedId = `m82-unverified-${Date.now()}`;
  const strangerId = `m82-stranger-${Date.now()}`;
  const missingId = `m82-missing-${Date.now()}`;
  let ownerProjectId = "";
  let strangerProjectId = "";
  const accounts = new AccountLifecycleService();
  const entitlements = new EntitlementService(accounts);
  const projects = new ProjectService();
  const intent = new IntentService(projects);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: verifiedId,
          name: "Verified",
          email: `${verifiedId}@example.com`,
          emailVerified: true,
        },
        {
          id: unverifiedId,
          name: "Unverified",
          email: `${unverifiedId}@example.com`,
          emailVerified: false,
        },
        {
          id: strangerId,
          name: "Stranger",
          email: `${strangerId}@example.com`,
          emailVerified: true,
        },
      ],
    });
    const ownerProject = await projects.create(verifiedId, {
      title: "Entitlement gate",
      logline: "M8.2 authorizeGeneration.",
    });
    ownerProjectId = ownerProject.id;
    const strangerProject = await projects.create(strangerId, {
      title: "Stranger project",
      logline: "Isolation.",
    });
    strangerProjectId = strangerProject.id;
  });

  afterAll(async () => {
    await prisma.engineCostEvent.deleteMany({
      where: { usageEvent: { userId: { in: [verifiedId, unverifiedId, strangerId] } } },
    });
    await prisma.usageEvent.deleteMany({
      where: { userId: { in: [verifiedId, unverifiedId, strangerId] } },
    });
    await prisma.generationAuthorization.deleteMany({
      where: { userId: { in: [verifiedId, unverifiedId, strangerId] } },
    });
    await prisma.accountPlatformState.deleteMany({
      where: { userId: { in: [verifiedId, unverifiedId, strangerId] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [ownerProjectId, strangerProjectId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [verifiedId, unverifiedId, strangerId] } },
    });
  });

  it("resolves free Constitution defaults when subscription and prepaid stubs are empty", async () => {
    const snapshot = await entitlements.resolve(verifiedId);
    expect(snapshot).toMatchObject({
      schemaVersion: "1.0",
      userId: verifiedId,
      planKind: PlanKind.FREE,
      movieGenerationsPerHour: FREE_MOVIE_GENERATIONS_PER_HOUR,
      maxOutputDurationMs: FREE_MAX_OUTPUT_DURATION_MS,
      watermarkRequired: true,
      adsEnabled: true,
    });
    await expect(new EmptySubscriptionResolver().resolve(verifiedId)).resolves.toEqual([]);
    await expect(new EmptyPrepaidResolver().resolve(verifiedId)).resolves.toEqual([]);
  });

  it("denies unverified users with EMAIL_UNVERIFIED even when duration is over max", async () => {
    const decision = await entitlements.authorizeGeneration(unverifiedId, {
      projectId: ownerProjectId,
      requestedMaxDurationMs: 720_000,
    });
    expect(decision).toEqual({
      allowed: false,
      code: EntitlementDenyCode.EMAIL_UNVERIFIED,
      message: "Verify your email before starting a movie.",
    });
    await expect(entitlements.requireGeneration(unverifiedId)).rejects.toMatchObject({
      code: "EMAIL_UNVERIFIED",
      status: 403,
    });
    expect(
      await prisma.generationAuthorization.count({ where: { userId: unverifiedId } }),
    ).toBe(0);
  });

  it("allows the first authorized MOVIE_GENERATION and denies the second within the hour", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: verifiedId } });
    const first = await entitlements.authorizeGeneration(verifiedId, {
      projectId: ownerProjectId,
      requestedMaxDurationMs: 90_000,
    });
    expect(first.allowed).toBe(true);
    if (!first.allowed) return;
    expect(first.snapshot.planKind).toBe(PlanKind.FREE);
    expect(first.remainingQuota).toMatchObject({
      kind: MeterKind.MOVIE_GENERATION,
      remaining: 0,
      limit: 1,
    });
    expect(first.constraints).toEqual({
      maxOutputDurationMs: FREE_MAX_OUTPUT_DURATION_MS,
      watermarkRequired: true,
      adsEnabled: true,
    });
    expect(
      await prisma.generationAuthorization.count({
        where: { userId: verifiedId, kind: MeterKind.MOVIE_GENERATION },
      }),
    ).toBe(1);

    const second = await entitlements.authorizeGeneration(verifiedId, {
      projectId: ownerProjectId,
    });
    expect(second).toMatchObject({
      allowed: false,
      code: EntitlementDenyCode.RATE_LIMITED,
    });
    await expect(entitlements.requireGeneration(verifiedId)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    expect(
      await prisma.generationAuthorization.count({
        where: { userId: verifiedId, kind: MeterKind.MOVIE_GENERATION },
      }),
    ).toBe(1);
  });

  it("denies requested duration over the free max without consuming quota", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: verifiedId } });
    const decision = await entitlements.authorizeGeneration(verifiedId, {
      requestedMaxDurationMs: FREE_MAX_OUTPUT_DURATION_MS + 1,
    });
    expect(decision).toEqual({
      allowed: false,
      code: EntitlementDenyCode.DURATION_EXCEEDS_PLAN,
      message: "Free movies can be at most 5 minutes long.",
    });
    await expect(
      entitlements.requireGeneration(verifiedId, { requestedMaxDurationMs: 720_000 }),
    ).rejects.toMatchObject({
      code: "DURATION_EXCEEDS_PLAN",
      status: 403,
    });
    expect(
      await prisma.generationAuthorization.count({ where: { userId: verifiedId } }),
    ).toBe(0);

    const atMax = await entitlements.authorizeGeneration(verifiedId, {
      requestedMaxDurationMs: FREE_MAX_OUTPUT_DURATION_MS,
    });
    expect(atMax.allowed).toBe(true);
  });

  it("denies over-max duration from project intent when authorize is given only projectId", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: verifiedId } });
    await intent.upsert(verifiedId, ownerProjectId, { desiredDurationMs: 720_000 });
    try {
      const decision = await entitlements.authorizeGeneration(verifiedId, {
        projectId: ownerProjectId,
      });
      expect(decision).toMatchObject({
        allowed: false,
        code: EntitlementDenyCode.DURATION_EXCEEDS_PLAN,
      });
      expect(
        await prisma.generationAuthorization.count({ where: { userId: verifiedId } }),
      ).toBe(0);
    } finally {
      await intent.upsert(verifiedId, ownerProjectId, { desiredDurationMs: 90_000 });
    }
  });

  it("does not let a stranger burn another user's quota", async () => {
    await prisma.generationAuthorization.deleteMany({
      where: { userId: { in: [verifiedId, strangerId] } },
    });
    const ownerFirst = await entitlements.authorizeGeneration(verifiedId, {
      projectId: ownerProjectId,
    });
    expect(ownerFirst.allowed).toBe(true);

    const strangerOnOwnerProject = await entitlements.authorizeGeneration(strangerId, {
      projectId: ownerProjectId,
    });
    expect(strangerOnOwnerProject.allowed).toBe(true);
    expect(
      await prisma.generationAuthorization.count({ where: { userId: verifiedId } }),
    ).toBe(1);
    expect(
      await prisma.generationAuthorization.count({ where: { userId: strangerId } }),
    ).toBe(1);

    const ownerSecond = await entitlements.authorizeGeneration(verifiedId, {
      projectId: strangerProjectId,
    });
    expect(ownerSecond).toMatchObject({
      allowed: false,
      code: EntitlementDenyCode.RATE_LIMITED,
    });
    expect(
      await prisma.generationAuthorization.count({ where: { userId: verifiedId } }),
    ).toBe(1);
  });

  it("does not count a generation older than the rolling hour", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: verifiedId } });
    await prisma.generationAuthorization.create({
      data: {
        userId: verifiedId,
        kind: MeterKind.MOVIE_GENERATION,
        recordedAt: new Date(Date.now() - 61 * 60 * 1000),
      },
    });
    const decision = await entitlements.authorizeGeneration(verifiedId);
    expect(decision.allowed).toBe(true);
  });

  it("denies quarantined accounts as SUSPENDED without consuming quota", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: strangerId } });
    await entitlements.setQuarantined(strangerId, true, "test-quarantine");
    const decision = await entitlements.authorizeGeneration(strangerId, {
      projectId: strangerProjectId,
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: EntitlementDenyCode.SUSPENDED,
    });
    await expect(entitlements.requireGeneration(strangerId)).rejects.toMatchObject({
      code: "SUSPENDED",
      status: 403,
    });
    expect(
      await prisma.generationAuthorization.count({ where: { userId: strangerId } }),
    ).toBe(0);
    const gate = await entitlements.getPlatformGate(strangerId);
    expect(gate).toMatchObject({
      canGenerate: false,
      denyCode: EntitlementDenyCode.SUSPENDED,
      emailVerified: true,
    });
    await entitlements.setQuarantined(strangerId, false, null);
  });

  it("does not write CreativePlan, UsageEvent, or billing rows when authorizing", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: verifiedId } });
    const plansBefore = await prisma.creativePlan.count({ where: { projectId: ownerProjectId } });
    await entitlements.authorizeGeneration(verifiedId, { projectId: ownerProjectId });
    await entitlements.authorizeGeneration(unverifiedId, { projectId: ownerProjectId });
    expect(await prisma.creativePlan.count({ where: { projectId: ownerProjectId } })).toBe(
      plansBefore,
    );
    expect(
      await prisma.usageEvent.count({
        where: { userId: { in: [verifiedId, unverifiedId] } },
      }),
    ).toBe(0);
    expect(prisma).not.toHaveProperty("subscription");
    expect(prisma).not.toHaveProperty("creditLedger");
    expect(prisma).not.toHaveProperty("invoice");
    expect(prisma).not.toHaveProperty("billing");
    expect("AI_ENTITLEMENT" in JobType).toBe(false);
    expect("AI_BILL" in JobType).toBe(false);
    expect("AI_ADS" in JobType).toBe(false);
  });

  it("keeps ALLOW constraints off the creative pipeline and reports missing accounts", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: verifiedId } });
    const decision = await entitlements.authorizeGeneration(verifiedId);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    const blob = JSON.stringify(decision);
    expect(blob).not.toMatch(/CreativePlan|StoryDocument|Timeline|stripe|BillingPort/i);
    expect(decision.snapshot).not.toHaveProperty("price");
    await expect(entitlements.resolve(missingId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("persists a non-creative constraint receipt on ALLOW even when duration is omitted", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: verifiedId } });
    const decision = await entitlements.authorizeGeneration(verifiedId, {
      projectId: ownerProjectId,
    });
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.constraints).toEqual({
      maxOutputDurationMs: FREE_MAX_OUTPUT_DURATION_MS,
      watermarkRequired: true,
      adsEnabled: true,
    });
    const receipt = await entitlements.latestConstraintReceipt(verifiedId, ownerProjectId);
    expect(receipt).toMatchObject({
      userId: verifiedId,
      projectId: ownerProjectId,
      maxOutputDurationMs: FREE_MAX_OUTPUT_DURATION_MS,
      watermarkRequired: true,
      adsEnabled: true,
    });
    const row = await prisma.generationAuthorization.findFirst({
      where: { userId: verifiedId, projectId: ownerProjectId },
    });
    expect(row).toMatchObject({
      maxOutputDurationMs: FREE_MAX_OUTPUT_DURATION_MS,
      watermarkRequired: true,
      adsEnabled: true,
    });
    await expect(
      entitlements.assertOutputDuration(
        verifiedId,
        FREE_MAX_OUTPUT_DURATION_MS + 1,
        ownerProjectId,
      ),
    ).rejects.toMatchObject({ code: "DURATION_EXCEEDS_PLAN" });
    const policy = await entitlements.policyConstraints(verifiedId, ownerProjectId);
    expect(policy.watermarkRequired).toBe(true);
    expect(policy.adsEnabled).toBe(true);
  });

  it("does not let a later longer intent override the ALLOW receipt cap", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: verifiedId } });
    await entitlements.authorizeGeneration(verifiedId, {
      projectId: ownerProjectId,
      requestedMaxDurationMs: 90_000,
    });
    await intent.upsert(verifiedId, ownerProjectId, { desiredDurationMs: 720_000 });
    try {
      await expect(
        entitlements.assertOutputDuration(verifiedId, 720_000, ownerProjectId),
      ).rejects.toMatchObject({ code: "DURATION_EXCEEDS_PLAN" });
      const receipt = await entitlements.latestConstraintReceipt(verifiedId, ownerProjectId);
      expect(receipt?.maxOutputDurationMs).toBe(FREE_MAX_OUTPUT_DURATION_MS);
    } finally {
      await intent.upsert(verifiedId, ownerProjectId, { desiredDurationMs: 90_000 });
    }
  });

  it("reports free-tier entitlement honesty and enforces produced duration", async () => {
    await prisma.generationAuthorization.deleteMany({ where: { userId: verifiedId } });
    const summary = await entitlements.getEntitlementSummary(verifiedId);
    expect(summary).toEqual({
      watermarkRequired: true,
      adsEnabled: true,
      maxOutputDurationMs: FREE_MAX_OUTPUT_DURATION_MS,
      remainingMovieGenerations: 1,
    });
    await expect(entitlements.assertOutputDuration(verifiedId, 299_999)).resolves.toBeUndefined();
    await expect(entitlements.assertOutputDuration(verifiedId, null)).resolves.toBeUndefined();
    await expect(
      entitlements.assertOutputDuration(verifiedId, FREE_MAX_OUTPUT_DURATION_MS + 1),
    ).rejects.toMatchObject({
      code: "DURATION_EXCEEDS_PLAN",
      status: 403,
    });
  });

  it("mergeSnapshot stays FREE for empty stubs and never invents prices", () => {
    const snapshot = mergeSnapshot(verifiedId, [], [], new Date("2026-09-09T00:00:00.000Z"));
    expect(snapshot.planKind).toBe(PlanKind.FREE);
    expect(snapshot).not.toHaveProperty("price");
    expect(JSON.stringify(snapshot)).not.toMatch(/stripe|cpm|sku/i);
  });
});
