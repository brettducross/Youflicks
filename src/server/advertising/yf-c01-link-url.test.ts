import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { FirstPartySponsorAdapter } from "@/server/adapters/advertising/first-party-sponsor";
import { CommercialSurface, IN_MOVIE_SURFACE } from "@/server/advertising/types";
import { prisma } from "@/server/db";
import { SponsorPlacementKind } from "@/server/domain/personalization";
import { AccountLifecycleService } from "@/server/services/account-lifecycle";
import { AdvertisingService } from "@/server/services/advertising";
import { CreditsService } from "@/server/services/credits";
import { EntitlementService } from "@/server/services/entitlement";
import { SponsorshipService } from "@/server/services/sponsorship";
import { TasteService } from "@/server/services/taste";

describe("YF-C01 first-party linkUrl https allowlist", () => {
  const ownerId = `yfc01-owner-${Date.now()}`;
  const viewerId = `yfc01-viewer-${Date.now()}`;
  const sponsorship = new SponsorshipService();
  const firstParty = new FirstPartySponsorAdapter();
  const ads = new AdvertisingService(
    new EntitlementService(new AccountLifecycleService()),
    new TasteService(),
    firstParty,
  );
  let campaignId = "";
  let sponsorId = "";

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "YF-C01 owner", email: `${ownerId}@example.com`, emailVerified: true },
        { id: viewerId, name: "YF-C01 viewer", email: `${viewerId}@example.com`, emailVerified: true },
      ],
    });
    const sponsor = await sponsorship.createSponsor(ownerId, "Allowlist Co");
    sponsorId = sponsor.id;
    const campaign = await sponsorship.createCampaign(ownerId, sponsor.id, "Allowlist");
    campaignId = campaign.id;
    await prisma.sponsorCampaign.update({
      where: { id: campaign.id },
      data: { status: "ACTIVE" },
    });
  });

  afterAll(async () => {
    await prisma.advertisingEvent.deleteMany({ where: { userId: { in: [ownerId, viewerId] } } });
    await prisma.sponsorOffer.deleteMany({ where: { campaignId } });
    await prisma.sponsorCampaign.deleteMany({ where: { id: campaignId } });
    await prisma.sponsor.deleteMany({ where: { id: sponsorId } });
    await prisma.userSponsorshipPreference.deleteMany({
      where: { userId: { in: [ownerId, viewerId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, viewerId] } } });
  });

  it("accepts a valid https destination on ingest", async () => {
    const offer = await sponsorship.createOffer(ownerId, campaignId, {
      placementKind: SponsorPlacementKind.LOGO,
      displayName: "Safe https",
      linkUrl: "https://sponsor.example/offer",
    });
    expect(offer.linkUrl).toBe("https://sponsor.example/offer");
    await prisma.sponsorOffer.delete({ where: { id: offer.id } });
  });

  it("rejects http, javascript, data, and malformed destinations on ingest", async () => {
    const rejected = [
      "http://insecure.example",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "",
      "not a url",
      "//protocol-relative.example",
      "/relative",
    ];
    for (const linkUrl of rejected) {
      await expect(
        sponsorship.createOffer(ownerId, campaignId, {
          placementKind: SponsorPlacementKind.LOGO,
          displayName: "Unsafe",
          linkUrl,
        }),
      ).rejects.toBeInstanceOf(AppError);
    }
    expect(
      await prisma.sponsorOffer.count({
        where: { campaignId, displayName: "Unsafe" },
      }),
    ).toBe(0);
  });

  it("does not expose an unsafe FilmCreditLine linkUrl as clickable", () => {
    const credits = new CreditsService();
    expect(
      credits.toLineView({
        id: "line-unsafe",
        displayName: "Harbor",
        providerKey: null,
        creditType: "SPONSOR",
        displayOrder: 1,
        logoKey: null,
        audioKey: null,
        videoKey: null,
        linkUrl: "javascript:alert(1)",
      }).linkUrl,
    ).toBeNull();
    expect(
      credits.toLineView({
        id: "line-safe",
        displayName: "Harbor",
        providerKey: null,
        creditType: "SPONSOR",
        displayOrder: 2,
        logoKey: null,
        audioKey: null,
        videoKey: null,
        linkUrl: "https://harbor.example",
      }).linkUrl,
    ).toBe("https://harbor.example/");
  });

  it("does not serve a clickable href when a stored destination is unsafe", async () => {
    const unsafe = await prisma.sponsorOffer.create({
      data: {
        campaignId,
        placementKind: SponsorPlacementKind.LOGO,
        displayName: "Legacy unsafe",
        linkUrl: "javascript:alert(1)",
      },
    });
    const creative = await firstParty.fetchCreative(CommercialSurface.UI_SHELL);
    expect(creative?.kind).toBe("FIRST_PARTY");
    expect(creative?.displayName).toBe("Legacy unsafe");
    expect(creative?.linkUrl).toBeNull();
    await prisma.sponsorOffer.delete({ where: { id: unsafe.id } });
  });

  it("serves allowlisted https and keeps IN_MOVIE empty", async () => {
    const offer = await sponsorship.createOffer(ownerId, campaignId, {
      placementKind: SponsorPlacementKind.LOGO,
      displayName: "Clickable",
      linkUrl: "https://click.example",
    });
    const creative = await firstParty.fetchCreative(CommercialSurface.UI_SHELL);
    expect(creative?.linkUrl).toBe("https://click.example/");
    await expect(firstParty.fetchCreative(IN_MOVIE_SURFACE)).resolves.toBeNull();
    await expect(ads.eligibleSurfaces(viewerId, { surface: IN_MOVIE_SURFACE })).resolves.toEqual(
      [],
    );
    const served = await ads.eligibleSurfaces(viewerId);
    expect(served.some((surface) => (surface.key as string) === IN_MOVIE_SURFACE)).toBe(false);
    await prisma.sponsorOffer.delete({ where: { id: offer.id } });
  });

  it("records clicks only for omit-or-https destinations", async () => {
    await ads.recordClick(viewerId, CommercialSurface.UI_SHELL);
    await ads.recordClick(viewerId, CommercialSurface.UI_SHELL, "https://click.example");
    await ads.recordClick(viewerId, CommercialSurface.UI_SHELL, "javascript:alert(1)");
    await ads.recordClick(viewerId, CommercialSurface.UI_SHELL, "http://insecure.example");
    await ads.recordClick(viewerId, CommercialSurface.UI_SHELL, "data:text/html,x");
    const clicks = await ads.listEvents({ userId: viewerId, kind: "click" });
    expect(clicks).toHaveLength(2);
    expect(clicks.every((event) => event.surface !== IN_MOVIE_SURFACE)).toBe(true);
  });

  it("does not leak commercial linkUrl into CreativePlan, Story, Timeline, or Render", async () => {
    const offer = await sponsorship.createOffer(ownerId, campaignId, {
      placementKind: SponsorPlacementKind.LOGO,
      displayName: "No leakage",
      linkUrl: "https://noleak.example",
    });
    const before = {
      creativePlan: await prisma.creativePlan.count(),
      story: await prisma.storyStructure.count(),
      timeline: await prisma.timeline.count(),
      render: await prisma.renderJob.count(),
    };
    const surfaces = await ads.eligibleSurfaces(viewerId);
    expect(surfaces.some((surface) => surface.linkUrl === "https://noleak.example/")).toBe(true);
    expect(await prisma.creativePlan.count()).toBe(before.creativePlan);
    expect(await prisma.storyStructure.count()).toBe(before.story);
    expect(await prisma.timeline.count()).toBe(before.timeline);
    expect(await prisma.renderJob.count()).toBe(before.render);
    await prisma.sponsorOffer.delete({ where: { id: offer.id } });
  });
});
