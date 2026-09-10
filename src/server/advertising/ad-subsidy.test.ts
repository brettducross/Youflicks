import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdSubsidyBridge, AD_SUBSIDY_POLICY } from "@/server/advertising/ad-subsidy";
import { CreditSource } from "@/server/billing/types";
import { prisma } from "@/server/db";
import { BillingService } from "@/server/services/billing";

describe("AdSubsidyBridge M8.6d stub", () => {
  const userId = `m86d-user-${Date.now()}`;
  const billing = new BillingService();
  const bridge = new AdSubsidyBridge(billing);

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, name: "Subsidy", email: `${userId}@example.com`, emailVerified: true },
    });
  });

  afterAll(async () => {
    await prisma.creditLedger.deleteMany({ where: { userId } });
    await prisma.creditBalance.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("keeps capQuantity null and refuses to grant as unlimited", async () => {
    expect(AD_SUBSIDY_POLICY.capQuantity).toBeNull();
    expect(AD_SUBSIDY_POLICY.capPeriod).toBeNull();
    expect(AD_SUBSIDY_POLICY.source).toBe(CreditSource.AD_SUBSIDY);
    await expect(bridge.tryGrant(userId, 1)).resolves.toEqual({
      granted: false,
      reason: "CAP_TBD",
    });
    await expect(bridge.tryGrant(userId, null)).resolves.toEqual({
      granted: false,
      reason: "CAP_TBD",
    });
    expect((await billing.getBalance(userId)).available).toBe(0);
    expect(
      await prisma.creditLedger.count({
        where: { userId, source: CreditSource.AD_SUBSIDY },
      }),
    ).toBe(0);
  });

  it("honors an injected numeric cap without treating the default as unlimited", async () => {
    const capped = new AdSubsidyBridge(billing, {
      source: CreditSource.AD_SUBSIDY,
      capQuantity: 3,
      capPeriod: "test",
    });
    const first = await capped.tryGrant(userId, 2);
    expect(first.granted).toBe(true);
    await expect(capped.tryGrant(userId, 2)).resolves.toEqual({
      granted: false,
      reason: "CAP_REACHED",
    });
    expect((await billing.getBalance(userId)).available).toBe(2);
  });
});
