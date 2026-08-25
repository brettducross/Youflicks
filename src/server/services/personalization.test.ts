import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  CreditType,
  PlacementStatus,
  SponsorPlacementKind,
  TasteDimension,
  TasteOrigin,
  TasteSignalKind,
} from "@/server/domain/personalization";
import { prisma } from "@/server/db";
import { AttributionService } from "@/server/services/attribution";
import { CreditsService } from "@/server/services/credits";
import { IntentService } from "@/server/services/intent";
import { ProjectService } from "@/server/services/projects";
import { SponsorshipService } from "@/server/services/sponsorship";
import { TasteService } from "@/server/services/taste";

describe("Phase 2D personalization foundation", () => {
  const filmmakerId = `taste-owner-${Date.now()}`;
  const strangerId = `taste-stranger-${Date.now()}`;
  const sponsorId = `taste-sponsor-${Date.now()}`;
  let projectId = "";
  const taste = new TasteService();
  const projects = new ProjectService();
  const intent = new IntentService(projects, taste);
  const attribution = new AttributionService(projects);
  const sponsorship = new SponsorshipService();
  const credits = new CreditsService(projects, attribution, taste, sponsorship);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: filmmakerId, name: "Filmmaker", email: `${filmmakerId}@example.com`, emailVerified: false },
        { id: strangerId, name: "Stranger", email: `${strangerId}@example.com`, emailVerified: false },
        { id: sponsorId, name: "Sponsor", email: `${sponsorId}@example.com`, emailVerified: false },
      ],
    });
    const project = await projects.create(filmmakerId, {
      title: "Birthday cut",
      logline: "A fast recap.",
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [filmmakerId, strangerId, sponsorId] } } });
  });

  it("keeps taste profiles owned by the subscriber", async () => {
    await taste.replacePreferences(filmmakerId, filmmakerId, {
      preferences: [{ dimension: TasteDimension.VISUAL_STYLE, value: "Cinematic and slow" }],
    });
    await expect(taste.getForUser(strangerId, filmmakerId)).rejects.toBeInstanceOf(AppError);
    await expect(taste.getForUser(strangerId, filmmakerId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const profile = await taste.getForUser(filmmakerId, filmmakerId);
    expect(profile.preferences[0]?.source).toBe(TasteOrigin.EXPLICIT);
    expect(profile.preferences[0]?.value).toBe("Cinematic and slow");
  });

  it("records explicit and inferred taste signals separately", async () => {
    const explicit = await taste.recordSignal(filmmakerId, filmmakerId, {
      kind: TasteSignalKind.USER_SELECTED_MOVIE,
      origin: TasteOrigin.EXPLICIT,
      payload: { title: "Moonlight" },
    });
    const inferred = await taste.recordSignal(filmmakerId, filmmakerId, {
      kind: TasteSignalKind.USER_CHANGED_EDIT,
      origin: TasteOrigin.INFERRED,
      payload: { longerCuts: true },
    });
    expect(explicit.origin).toBe(TasteOrigin.EXPLICIT);
    expect(inferred.origin).toBe(TasteOrigin.INFERRED);
    expect(explicit.kind).not.toBe(inferred.kind);
    await expect(
      taste.recordSignal(strangerId, filmmakerId, {
        kind: TasteSignalKind.USER_RATED_FILM,
        origin: TasteOrigin.EXPLICIT,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps project creative intent owned by the filmmaker", async () => {
    await expect(
      intent.upsert(strangerId, projectId, { mood: "Nope" }),
    ).rejects.toBeInstanceOf(AppError);
    const saved = await intent.upsert(filmmakerId, projectId, {
      mood: "Funny and fast",
      visualStyle: "Handheld and bright",
      purpose: "Birthday",
    });
    expect(saved.mood).toBe("Funny and fast");
    const brief = await intent.resolveBrief(filmmakerId, projectId);
    expect(brief.effective.visualStyle).toBe("Handheld and bright");
    expect(brief.effective.overriddenByProject).toContain("visualStyle");
    expect(brief.taste.preferences.some((item) => item.value === "Cinematic and slow")).toBe(true);
  });

  it("records provider-neutral attribution for multiple providers", async () => {
    const first = await attribution.record({
      projectId,
      assetId: "asset-a",
      jobId: "job-a",
      providerKey: "youflicks.local.technical",
      capability: "IMAGE_ANALYSIS",
      modelId: "metadata-v1",
      modelVersion: "1.0",
    });
    const second = await attribution.record({
      projectId,
      assetId: "asset-b",
      jobId: "job-b",
      providerKey: "http.vision",
      capability: "VISION",
      modelId: "vision-small",
    });
    expect(first.providerKey).toBe("youflicks.local.technical");
    expect(second.capability).toBe("VISION");
    await expect(attribution.listForProject(strangerId, projectId)).rejects.toBeInstanceOf(AppError);
    const listed = await attribution.listForProject(filmmakerId, projectId);
    expect(listed.map((item) => item.providerKey).sort()).toEqual([
      "http.vision",
      "youflicks.local.technical",
    ]);
    expect(JSON.stringify(listed)).not.toMatch(/gemini|openai|anthropic/i);
  });

  it("builds film credits from attribution without a renderer", async () => {
    const built = await credits.buildForProject(filmmakerId, projectId);
    expect(built.lines[0]?.creditType).toBe(CreditType.YOUFLICKS);
    expect(built.lines.some((line) => line.providerKey === "http.vision")).toBe(true);
    expect(built.lines.some((line) => line.creditType === CreditType.SPONSOR)).toBe(false);
    await expect(credits.getLatest(strangerId, projectId)).rejects.toBeInstanceOf(AppError);
  });

  it("enforces sponsor ownership and isolation from taste and media", async () => {
    const sponsor = await sponsorship.createSponsor(sponsorId, "Harbor Coffee");
    await expect(sponsorship.getOwnedSponsor(filmmakerId, sponsor.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const campaign = await sponsorship.createCampaign(sponsorId, sponsor.id, "Summer");
    const offer = await sponsorship.createOffer(sponsorId, campaign.id, {
      placementKind: SponsorPlacementKind.CREDIT_ONLY,
      displayName: "Harbor Coffee",
    });
    const placement = await sponsorship.proposePlacement(sponsorId, offer.id, projectId);
    expect(placement.status).toBe(PlacementStatus.ELIGIBLE);

    await expect(sponsorship.readSubscriberTaste(sponsorId, filmmakerId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      sponsorship.readSubscriberMedia(sponsorId, projectId, "any-asset"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sponsorship.readSubscriberAnalysis()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(taste.getForUser(sponsorId, filmmakerId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("keeps sponsorship off by default and only adds approved credits when opted in", async () => {
    const defaults = await taste.getSponsorshipPreferences(filmmakerId, filmmakerId);
    expect(defaults.allowSponsorCredits).toBe(false);
    expect(defaults.allowVideoAds).toBe(false);

    const sponsor = await sponsorship.createSponsor(sponsorId, "Second Sponsor");
    const campaign = await sponsorship.createCampaign(sponsorId, sponsor.id, "End card");
    const offer = await sponsorship.createOffer(sponsorId, campaign.id, {
      placementKind: SponsorPlacementKind.CREDIT_ONLY,
      displayName: "Second Sponsor",
    });
    const placement = await sponsorship.proposePlacement(sponsorId, offer.id, projectId);
    await sponsorship.approvePlacement(filmmakerId, placement.id);

    const withoutOptIn = await credits.buildForProject(filmmakerId, projectId);
    expect(withoutOptIn.lines.some((line) => line.creditType === CreditType.SPONSOR)).toBe(false);

    await taste.updateSponsorshipPreferences(filmmakerId, filmmakerId, {
      allowSponsorCredits: true,
    });
    const withOptIn = await credits.buildForProject(filmmakerId, projectId);
    expect(withOptIn.lines.some((line) => line.displayName === "Second Sponsor")).toBe(true);
  });
});
