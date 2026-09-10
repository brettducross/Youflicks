import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommercialSurface, IN_MOVIE_SURFACE } from "@/server/advertising/types";
import { prisma } from "@/server/db";
import { JobType } from "@/server/domain/status";
import type { SubscriptionResolver } from "@/server/entitlement/resolvers";
import { AccountLifecycleService } from "@/server/services/account-lifecycle";
import { AdvertisingService } from "@/server/services/advertising";
import { EntitlementService } from "@/server/services/entitlement";
import { TasteService } from "@/server/services/taste";

describe("AdvertisingService M8.4 stub", () => {
  const freeId = `m84-ads-free-${Date.now()}`;
  const paidId = `m84-ads-paid-${Date.now()}`;
  const taste = new TasteService();
  const accounts = new AccountLifecycleService();
  const freeAds = new AdvertisingService(new EntitlementService(accounts), taste);
  const paidResolver: SubscriptionResolver = {
    async resolve(userId) {
      if (userId !== paidId) return [];
      return [{ planKey: "test.paid", adsEnabled: false, watermarkRequired: false }];
    },
  };
  const paidAds = new AdvertisingService(
    new EntitlementService(accounts, paidResolver),
    taste,
  );

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: freeId, name: "Free", email: `${freeId}@example.com`, emailVerified: true },
        { id: paidId, name: "Paid", email: `${paidId}@example.com`, emailVerified: true },
      ],
    });
  });

  afterAll(async () => {
    await prisma.advertisingEvent.deleteMany({
      where: { userId: { in: [freeId, paidId] } },
    });
    await prisma.userSponsorshipPreference.deleteMany({
      where: { userId: { in: [freeId, paidId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [freeId, paidId] } } });
  });

  it("serves shell and post-film surfaces when free-tier adsEnabled is true", async () => {
    const surfaces = await freeAds.eligibleSurfaces(freeId);
    expect(surfaces.map((surface) => surface.key).sort()).toEqual(
      [
        CommercialSurface.LIBRARY_BANNER,
        CommercialSurface.POST_FILM,
        CommercialSurface.UI_SHELL,
      ].sort(),
    );
    expect(surfaces.every((surface) => surface.kind === "STUB")).toBe(true);
    expect(surfaces.some((surface) => (surface.key as string) === IN_MOVIE_SURFACE)).toBe(false);
    const honesty = await freeAds.adsHonesty(freeId);
    expect(honesty).toMatchObject({
      adsEnabled: true,
      adsRequired: true,
      preferenceCannotOptOut: true,
    });
  });

  it("returns no surfaces when adsEnabled is false", async () => {
    await expect(paidAds.eligibleSurfaces(paidId)).resolves.toEqual([]);
    await expect(paidAds.adsHonesty(paidId)).resolves.toMatchObject({
      adsEnabled: false,
      adsRequired: false,
    });
  });

  it("does not let Phase 2D prefs hard opt-out of free-tier ads", async () => {
    await taste.updateSponsorshipPreferences(freeId, freeId, { allowVideoAds: false });
    const prefs = await taste.getSponsorshipPreferences(freeId, freeId);
    expect(prefs.allowVideoAds).toBe(false);
    const surfaces = await freeAds.eligibleSurfaces(freeId);
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces.map((surface) => surface.key)).toContain(CommercialSurface.POST_FILM);
  });

  it("never serves in-movie ads and does not write CreativePlan", async () => {
    const before = await prisma.creativePlan.count();
    await expect(
      freeAds.eligibleSurfaces(freeId, { surface: IN_MOVIE_SURFACE }),
    ).resolves.toEqual([]);
    await freeAds.recordImpression(freeId, IN_MOVIE_SURFACE);
    await freeAds.recordClick(freeId, CommercialSurface.UI_SHELL);
    await freeAds.recordImpression(freeId, CommercialSurface.UI_SHELL);
    const events = await freeAds.listEvents({ userId: freeId });
    expect(events.every((event) => event.surface !== IN_MOVIE_SURFACE)).toBe(true);
    expect(events.some((event) => event.kind === "click")).toBe(true);
    expect(await prisma.creativePlan.count()).toBe(before);
    expect("AI_ADS" in JobType).toBe(false);
    expect(prisma).not.toHaveProperty("billing");
    expect(JSON.stringify(await freeAds.eligibleSurfaces(freeId))).not.toMatch(
      /stripe|adsense|planKind/i,
    );
  });
});
