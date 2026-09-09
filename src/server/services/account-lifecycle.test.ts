import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import { AccountDenyCode } from "@/server/account/types";
import {
  AccountLifecycleService,
  withGenerationHonesty,
} from "@/server/services/account-lifecycle";
import { ProjectService } from "@/server/services/projects";

describe("AccountLifecycleService M8.1 email gate", () => {
  const verifiedId = `m81-verified-${Date.now()}`;
  const unverifiedId = `m81-unverified-${Date.now()}`;
  const missingId = `m81-missing-${Date.now()}`;
  let projectId = "";
  const sent: Array<{ userId: string; email: string }> = [];
  const accounts = new AccountLifecycleService(async (input) => {
    sent.push(input);
  });

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
      ],
    });
    const project = await new ProjectService().create(verifiedId, {
      title: "Email gate",
      logline: "M8.1 authorizeGeneration.",
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.usageEvent.deleteMany({
      where: { userId: { in: [verifiedId, unverifiedId] } },
    });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [verifiedId, unverifiedId] } } });
  });

  it("denies authorizeGeneration when email is unverified", async () => {
    const decision = await accounts.authorizeGeneration(unverifiedId, { projectId });
    expect(decision).toEqual({
      allowed: false,
      code: AccountDenyCode.EMAIL_UNVERIFIED,
      message: "Verify your email before starting a movie.",
    });
    await expect(accounts.requireGeneration(unverifiedId)).rejects.toMatchObject({
      code: "EMAIL_UNVERIFIED",
      status: 403,
    });
  });

  it("allows authorizeGeneration when email is verified (no quota yet)", async () => {
    const decision = await accounts.authorizeGeneration(verifiedId, {
      projectId,
      requestedMaxDurationMs: 720_000,
    });
    expect(decision).toEqual({ allowed: true });
    const required = await accounts.requireGeneration(verifiedId, { projectId });
    expect(required).toEqual({ allowed: true });
  });

  it("keeps the M8.1 allow payload free of billing and creative fields", async () => {
    const decision = await accounts.authorizeGeneration(verifiedId);
    const blob = JSON.stringify(decision);
    expect(blob).not.toMatch(
      /planKind|adsEnabled|watermarkRequired|Billing|stripe|CreativePlan|StoryDocument|Timeline/i,
    );
    expect(decision).not.toHaveProperty("snapshot");
    expect(decision).not.toHaveProperty("remainingQuota");
    expect(decision).not.toHaveProperty("constraints");
  });

  it("does not write CreativePlan or UsageEvent-shaped rows when authorizing", async () => {
    const plansBefore = await prisma.creativePlan.count({ where: { projectId } });
    await accounts.authorizeGeneration(verifiedId, { projectId });
    await accounts.authorizeGeneration(unverifiedId, { projectId });
    expect(await prisma.creativePlan.count({ where: { projectId } })).toBe(plansBefore);
    expect(
      await prisma.usageEvent.count({
        where: { userId: { in: [verifiedId, unverifiedId] } },
      }),
    ).toBe(0);
    expect(prisma).not.toHaveProperty("subscription");
    expect(prisma).not.toHaveProperty("creditLedger");
    expect(prisma).not.toHaveProperty("invoice");
  });

  it("reports session honesty on AccountGate", async () => {
    await expect(accounts.getAccountGate(verifiedId)).resolves.toEqual({
      userId: verifiedId,
      emailVerified: true,
      canGenerate: true,
      denyCode: null,
    });
    await expect(accounts.getAccountGate(unverifiedId)).resolves.toEqual({
      userId: unverifiedId,
      emailVerified: false,
      canGenerate: false,
      denyCode: AccountDenyCode.EMAIL_UNVERIFIED,
    });
    await expect(accounts.getAccountGate(missingId)).rejects.toBeInstanceOf(AppError);
  });

  it("merges adapter availability with the email gate without changing compose capability", async () => {
    const adapter = {
      productionAvailable: true,
      localDevAvailable: false,
      canCompose: true,
    };
    const unverified = await accounts.getAccountGate(unverifiedId);
    const verified = await accounts.getAccountGate(verifiedId);
    expect(withGenerationHonesty(adapter, unverified)).toMatchObject({
      canCompose: true,
      canGenerate: false,
      emailVerified: false,
      generationDenyCode: AccountDenyCode.EMAIL_UNVERIFIED,
    });
    expect(withGenerationHonesty(adapter, verified)).toMatchObject({
      canCompose: true,
      canGenerate: true,
      emailVerified: true,
      generationDenyCode: null,
    });
  });

  it("requests a verification email only for unverified accounts", async () => {
    sent.length = 0;
    await expect(accounts.requestVerificationEmail(verifiedId)).resolves.toEqual({
      sent: false,
      alreadyVerified: true,
    });
    expect(sent).toEqual([]);
    await expect(accounts.requestVerificationEmail(unverifiedId)).resolves.toEqual({
      sent: true,
      alreadyVerified: false,
    });
    expect(sent).toEqual([{ userId: unverifiedId, email: `${unverifiedId}@example.com` }]);
    await expect(accounts.requestVerificationEmail(missingId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
