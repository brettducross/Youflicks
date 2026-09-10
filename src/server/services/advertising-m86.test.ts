import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommercialSurface, IN_MOVIE_SURFACE } from "@/server/advertising/types";
import { BillingSubscriptionResolver } from "@/server/billing/resolvers";
import { PlanKey, SubscriptionStatus } from "@/server/billing/types";
import { prisma } from "@/server/db";
import { PlacementStatus, SponsorPlacementKind } from "@/server/domain/personalization";
import { AccountLifecycleService } from "@/server/services/account-lifecycle";
import { AdvertisingService } from "@/server/services/advertising";
import { BillingService } from "@/server/services/billing";
import { EntitlementService } from "@/server/services/entitlement";
import { ProjectService } from "@/server/services/projects";
import { SponsorshipService } from "@/server/services/sponsorship";
import { TasteService } from "@/server/services/taste";

describe("AdvertisingService M8.6a/b", () => {
  const freeId = `m86-free-${Date.now()}`;
  const plusId = `m86-plus-${Date.now()}`;
  const familyId = `m86-family-${Date.now()}`;
  const sponsorOwnerId = `m86-sponsor-${Date.now()}`;
  const accounts = new AccountLifecycleService();
  const taste = new TasteService();
  const billing = new BillingService();
  const entitlements = new EntitlementService(accounts, new BillingSubscriptionResolver());
  const ads = new AdvertisingService(entitlements, taste);
  const sponsorship = new SponsorshipService();
  const projects = new ProjectService();
  let projectId = "";
  let logoOfferId = "";
  let creditOfferId = "";

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: freeId, name: "Free", email: `${freeId}@example.com`, emailVerified: true },
        { id: plusId, name: "Plus", email: `${plusId}@example.com`, emailVerified: true },
        { id: familyId, name: "Family", email: `${familyId}@example.com`, emailVerified: true },
        {
          id: sponsorOwnerId,
          name: "Sponsor",
          email: `${sponsorOwnerId}@example.com`,
          emailVerified: true,
        },
      ],
    });
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
    const project = await projects.create(freeId, {
      title: "Ad surfaces",
      logline: "First-party serve.",
    });
    projectId = project.id;
    const sponsor = await sponsorship.createSponsor(sponsorOwnerId, "Harbor Co");
    const campaign = await sponsorship.createCampaign(
      sponsorOwnerId,
      sponsor.id,
      "Harbor launch",
    );
    await prisma.sponsorCampaign.update({
      where: { id: campaign.id },
      data: { status: "ACTIVE" },
    });
    const logo = await sponsorship.createOffer(sponsorOwnerId, campaign.id, {
      placementKind: SponsorPlacementKind.LOGO,
      displayName: "Harbor Co",
      linkUrl: "https://harbor.example",
    });
    logoOfferId = logo.id;
    const credit = await sponsorship.createOffer(sponsorOwnerId, campaign.id, {
      placementKind: SponsorPlacementKind.CREDIT_ONLY,
      displayName: "Harbor Co credits",
    });
    creditOfferId = credit.id;
    const placement = await sponsorship.proposePlacement(
      sponsorOwnerId,
      credit.id,
      projectId,
    );
    await sponsorship.approvePlacement(freeId, placement.id);
  });

  afterAll(async () => {
    const ids = [freeId, plusId, familyId, sponsorOwnerId];
    await prisma.advertisingEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.sponsorPlacement.deleteMany({ where: { projectId } });
    await prisma.sponsorOffer.deleteMany({
      where: { id: { in: [logoOfferId, creditOfferId] } },
    });
    await prisma.sponsorCampaign.deleteMany({ where: { sponsor: { ownerId: sponsorOwnerId } } });
    await prisma.sponsor.deleteMany({ where: { ownerId: sponsorOwnerId } });
    await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.userSponsorshipPreference.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("persists impressions and clicks and exposes ops queries", async () => {
    await ads.recordImpression(freeId, CommercialSurface.UI_SHELL);
    await ads.recordClick(freeId, CommercialSurface.LIBRARY_BANNER);
    await ads.recordImpression(freeId, IN_MOVIE_SURFACE);
    const listed = await ads.listEvents({ userId: freeId });
    expect(listed).toHaveLength(2);
    expect(listed.map((event) => event.kind).sort()).toEqual(["click", "impression"]);
    expect(listed.every((event) => event.surface !== IN_MOVIE_SURFACE)).toBe(true);
    const clicks = await ads.listEvents({
      userId: freeId,
      kind: "click",
      surface: CommercialSurface.LIBRARY_BANNER,
    });
    expect(clicks).toHaveLength(1);
    expect(
      await prisma.advertisingEvent.count({
        where: { userId: freeId, surface: IN_MOVIE_SURFACE },
      }),
    ).toBe(0);
  });

  it("serves first-party creatives on allowed surfaces and keeps IN_MOVIE empty", async () => {
    const surfaces = await ads.eligibleSurfaces(freeId, { projectId });
    expect(surfaces.some((surface) => surface.key === CommercialSurface.UI_SHELL)).toBe(true);
    expect(surfaces.some((surface) => surface.key === CommercialSurface.POST_FILM)).toBe(true);
    expect(surfaces.some((surface) => surface.key === CommercialSurface.LIBRARY_BANNER)).toBe(
      true,
    );
    const shell = surfaces.find((surface) => surface.key === CommercialSurface.UI_SHELL);
    expect(shell?.kind).toBe("FIRST_PARTY");
    expect(shell?.displayName).toBe("Harbor Co");
    const credits = surfaces.find((surface) => surface.key === CommercialSurface.FILM_CREDITS);
    expect(credits?.kind).toBe("FIRST_PARTY");
    expect(credits?.displayName).toBe("Harbor Co credits");
    await expect(
      ads.eligibleSurfaces(freeId, { surface: IN_MOVIE_SURFACE, projectId }),
    ).resolves.toEqual([]);
    expect(surfaces.some((surface) => (surface.key as string) === IN_MOVIE_SURFACE)).toBe(
      false,
    );
    expect(await prisma.sponsorPlacement.count({
      where: { projectId, status: PlacementStatus.APPROVED },
    })).toBe(1);
  });

  it("turns ads off by default for PLUS and FAMILY via entitlement grants", async () => {
    await expect(ads.eligibleSurfaces(plusId)).resolves.toEqual([]);
    await expect(ads.eligibleSurfaces(familyId)).resolves.toEqual([]);
    await expect(ads.adsHonesty(plusId)).resolves.toMatchObject({
      adsEnabled: false,
      adsRequired: false,
    });
    await expect(ads.adsHonesty(familyId)).resolves.toMatchObject({ adsEnabled: false });
    const freeHonesty = await ads.adsHonesty(freeId);
    expect(freeHonesty.adsEnabled).toBe(true);
    expect(freeHonesty.preferenceCannotOptOut).toBe(true);
  });
});
