import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expireUnusedCredits } from "@/server/billing/credit-expiry";
import { PLAN_GRANT_SHAPES } from "@/server/billing/plan-catalog";
import { BillingPrepaidResolver, BillingSubscriptionResolver } from "@/server/billing/resolvers";
import {
  CREDIT_EXPIRY_POLICY,
  CreditLedgerEntryType,
  CreditSource,
  PlanKey,
  SubscriptionStatus,
} from "@/server/billing/types";
import { prisma } from "@/server/db";
import { JobType } from "@/server/domain/status";
import { PlanKind } from "@/server/entitlement/types";
import { AccountLifecycleService } from "@/server/services/account-lifecycle";
import { BillingService } from "@/server/services/billing";
import { EntitlementService } from "@/server/services/entitlement";
import { UsageKind } from "@/server/usage/types";

describe("BillingService M8.5a", () => {
  const userId = `m85-user-${Date.now()}`;
  const plusId = `m85-plus-${Date.now()}`;
  const familyId = `m85-family-${Date.now()}`;
  const prepaidId = `m85-prepaid-${Date.now()}`;
  const missingId = `m85-missing-${Date.now()}`;
  const billing = new BillingService();
  const accounts = new AccountLifecycleService();
  const entitlements = new EntitlementService(
    accounts,
    new BillingSubscriptionResolver(),
    new BillingPrepaidResolver(),
  );

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: userId, name: "Bill", email: `${userId}@example.com`, emailVerified: true },
        { id: plusId, name: "Plus", email: `${plusId}@example.com`, emailVerified: true },
        { id: familyId, name: "Family", email: `${familyId}@example.com`, emailVerified: true },
        { id: prepaidId, name: "Prepaid", email: `${prepaidId}@example.com`, emailVerified: true },
      ],
    });
  });

  afterAll(async () => {
    const ids = [userId, plusId, familyId, prepaidId];
    await prisma.creditLedger.deleteMany({ where: { userId: { in: ids } } });
    await prisma.creditBalance.deleteMany({ where: { userId: { in: ids } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
    await prisma.offerCatalog.deleteMany({
      where: { offerKey: { in: ["plan.free", "plan.plus", "plan.family"] } },
    });
    await prisma.generationAuthorization.deleteMany({ where: { userId: { in: ids } } });
    await prisma.accountPlatformState.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("ships FREE / PLUS / FAMILY grant shapes with TBD numeric fields and no prices", async () => {
    expect(PLAN_GRANT_SHAPES.FREE.adsEnabled).toBe(true);
    expect(PLAN_GRANT_SHAPES.FREE.watermarkRequired).toBe(true);
    expect(PLAN_GRANT_SHAPES.PLUS.adsEnabled).toBe(false);
    expect(PLAN_GRANT_SHAPES.PLUS.watermarkRequired).toBe(false);
    expect(PLAN_GRANT_SHAPES.FAMILY.adsEnabled).toBe(false);
    expect(PLAN_GRANT_SHAPES.FAMILY.familyProfiles).toBe(true);
    expect(PLAN_GRANT_SHAPES.PLUS.movieGenerationsPerHour).toBeNull();
    expect(PLAN_GRANT_SHAPES.PLUS.maxOutputDurationMs).toBeNull();
    expect(PLAN_GRANT_SHAPES.PLUS.storageBytes).toBeNull();
    expect(PLAN_GRANT_SHAPES.PLUS.priceAmount).toBeNull();
    expect(PLAN_GRANT_SHAPES.FAMILY.movieGenerationsPerHour).toBeNull();
    expect(PLAN_GRANT_SHAPES.FAMILY.maxOutputDurationMs).toBeNull();
    expect(PLAN_GRANT_SHAPES.FAMILY.storageBytes).toBeNull();
    expect(PLAN_GRANT_SHAPES.FAMILY.priceAmount).toBeNull();
    expect(PLAN_GRANT_SHAPES.FAMILY.priceCurrency).toBeNull();

    const offers = await billing.listOffers();
    expect(offers.map((offer) => offer.planKey).sort()).toEqual(
      [PlanKey.FAMILY, PlanKey.FREE, PlanKey.PLUS].sort(),
    );
    expect(offers.every((offer) => offer.priceAmount == null)).toBe(true);
    expect(JSON.stringify(offers)).not.toMatch(/stripe|sku|9\.99|19\.99/i);
  });

  it("fills mergeSnapshot from PLUS / FAMILY flags without inventing numeric caps", async () => {
    await billing.recordSubscription({
      userId: plusId,
      planKey: PlanKey.PLUS,
      status: SubscriptionStatus.ACTIVE,
      providerKey: "youflicks.test",
    });
    await billing.recordSubscription({
      userId: familyId,
      planKey: PlanKey.FAMILY,
      status: SubscriptionStatus.ACTIVE,
      providerKey: "youflicks.test",
    });

    const plus = await entitlements.resolve(plusId);
    expect(plus.planKind).toBe(PlanKind.SUBSCRIPTION);
    expect(plus.adsEnabled).toBe(false);
    expect(plus.watermarkRequired).toBe(false);
    expect(plus.movieGenerationsPerHour).toBe(1);
    expect(plus.maxOutputDurationMs).toBe(300_000);
    expect(plus).not.toHaveProperty("price");

    const family = await entitlements.resolve(familyId);
    expect(family.adsEnabled).toBe(false);
    expect(family.watermarkRequired).toBe(false);
    expect(family.movieGenerationsPerHour).toBe(1);
    expect(family.maxOutputDurationMs).toBe(300_000);
  });

  it("allows subscribers to hold prepaid credits and never silently drops them", async () => {
    await billing.recordSubscription({
      userId: plusId,
      planKey: PlanKey.PLUS,
      status: SubscriptionStatus.ACTIVE,
      providerKey: "youflicks.test",
      externalRef: "plus-sub-1",
    });
    await billing.applyCredit(plusId, {
      quantity: 7,
      source: CreditSource.PREPAID,
      reason: "support_grant",
    });
    const hybrid = await entitlements.resolve(plusId);
    expect(hybrid.planKind).toBe(PlanKind.HYBRID);
    expect(hybrid.adsEnabled).toBe(false);

    expect(billing.expiryPolicy()).toBe("NEVER");
    expect(CREDIT_EXPIRY_POLICY).toBe("NEVER");
    expect(expireUnusedCredits()).toEqual({ expired: 0, reason: "NEVER" });
    await expect(
      billing.trySpendForUsage(plusId, { kind: "EXPIRE_PROBE", quantity: 1 }),
    ).resolves.toBeNull();

    const { appendLedgerEntry } = await import("@/server/billing/ledger");
    await expect(
      appendLedgerEntry({
        userId: plusId,
        entryType: CreditLedgerEntryType.EXPIRE,
        quantity: 7,
        reason: "silent_drop",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const after = await billing.getBalance(plusId);
    expect(after.available).toBe(7);
    const ledger = await billing.listLedger(plusId);
    expect(ledger.every((entry) => entry.entryType !== CreditLedgerEntryType.EXPIRE)).toBe(
      true,
    );
    expect(ledger.every((entry) => entry.expiresAt == null)).toBe(true);
  });

  it("maps prepaid ledger into mergeSnapshot without a 1:1 movie spend", async () => {
    await billing.applyCredit(prepaidId, { quantity: 4, reason: "promo" });
    const snapshot = await entitlements.resolve(prepaidId);
    expect(snapshot.planKind).toBe(PlanKind.PREPAID);
    expect(snapshot.adsEnabled).toBe(true);
    expect(billing.debitQuantityForUsage({ kind: UsageKind.MOVIE_GENERATION, quantity: 1 })).toBeNull();
    await expect(
      billing.trySpendForUsage(prepaidId, {
        kind: UsageKind.MOVIE_GENERATION,
        quantity: 1,
        costUnits: 100,
      }),
    ).resolves.toBeNull();
    expect((await billing.getBalance(prepaidId)).available).toBe(4);
  });

  it("refuses live checkout while prices and payment provider are TBD", async () => {
    const session = await billing.createCheckout(userId, "plan.plus");
    expect(session).toEqual({
      status: "UNAVAILABLE",
      reason: "PRICE_TBD",
      offerKey: "plan.plus",
    });
    await expect(billing.handleWebhook("none", {}, "")).resolves.toEqual({
      status: "UNAVAILABLE",
      reason: "NO_PAYMENT_PROVIDER",
    });
    await expect(billing.createCheckout(missingId, "plan.plus")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect("AI_BILL" in JobType).toBe(false);
  });

  it("keeps billing records off CreativePlan tables", async () => {
    const plans = await prisma.creativePlan.count();
    await billing.applyCredit(userId, { quantity: 1, reason: "boundary" });
    expect(await prisma.creativePlan.count()).toBe(plans);
  });
});
