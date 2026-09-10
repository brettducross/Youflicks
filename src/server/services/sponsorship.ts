import "server-only";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { persistableSponsorLinkUrl } from "@/server/advertising/link-url";
import { PlacementStatus, SponsorPlacementKind } from "@/server/domain/personalization";
import { prisma } from "@/server/db";

/**
 * Sponsorship is presentation after the film is complete.
 * These methods never write story, timeline, taste, or render decisions.
 */
export class SponsorshipService {

  async createSponsor(ownerId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw AppError.validation("A sponsor needs a name.");
    }
    const row = await prisma.sponsor.create({ data: { ownerId, name: trimmed } });
    logger.info("sponsor.created", { ownerId, sponsorId: row.id });
    return row;
  }

  async getOwnedSponsor(ownerId: string, sponsorId: string) {
    const row = await prisma.sponsor.findFirst({ where: { id: sponsorId, ownerId } });
    if (!row) {
      throw AppError.notFound("That sponsor is not in your account.");
    }
    return row;
  }

  async createCampaign(ownerId: string, sponsorId: string, name: string) {
    await this.getOwnedSponsor(ownerId, sponsorId);
    const trimmed = name.trim();
    if (!trimmed) {
      throw AppError.validation("A campaign needs a name.");
    }
    return prisma.sponsorCampaign.create({
      data: { sponsorId, name: trimmed, status: "DRAFT" },
    });
  }

  async createOffer(
    ownerId: string,
    campaignId: string,
    input: { placementKind: string; displayName: string; linkUrl?: string | null },
  ) {
    const campaign = await prisma.sponsorCampaign.findUnique({
      where: { id: campaignId },
      include: { sponsor: true },
    });
    if (!campaign || campaign.sponsor.ownerId !== ownerId) {
      throw AppError.notFound("That campaign is not in your account.");
    }
    if (!Object.values(SponsorPlacementKind).includes(input.placementKind as never)) {
      throw AppError.validation("Unknown placement kind.");
    }
    return prisma.sponsorOffer.create({
      data: {
        campaignId,
        placementKind: input.placementKind,
        displayName: input.displayName.trim(),
        linkUrl: persistableSponsorLinkUrl(input.linkUrl),
      },
    });
  }

  async proposePlacement(ownerId: string, offerId: string, projectId: string) {
    const offer = await prisma.sponsorOffer.findUnique({
      where: { id: offerId },
      include: { campaign: { include: { sponsor: true } } },
    });
    if (!offer || offer.campaign.sponsor.ownerId !== ownerId) {
      throw AppError.notFound("That offer is not in your account.");
    }
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw AppError.notFound("That project does not exist.");
    }
    return prisma.sponsorPlacement.create({
      data: {
        offerId,
        projectId,
        status: PlacementStatus.ELIGIBLE,
      },
    });
  }

  async approvePlacement(filmmakerId: string, placementId: string) {
    const placement = await prisma.sponsorPlacement.findUnique({
      where: { id: placementId },
      include: { project: true },
    });
    if (!placement || placement.project.ownerId !== filmmakerId) {
      throw AppError.forbidden("Only the filmmaker can approve a placement on their film.");
    }
    return prisma.sponsorPlacement.update({
      where: { id: placementId },
      data: { status: PlacementStatus.APPROVED },
    });
  }

  async listApprovedForProject(projectId: string) {
    return prisma.sponsorPlacement.findMany({
      where: { projectId, status: PlacementStatus.APPROVED },
      include: { offer: { include: { campaign: { include: { sponsor: true } } } } },
    });
  }

  async readSubscriberTaste(sponsorOwnerId: string, subscriberUserId: string) {
    void sponsorOwnerId;
    void subscriberUserId;
    throw AppError.forbidden("Sponsors cannot access subscriber taste.");
  }

  async readSubscriberMedia(sponsorOwnerId: string, projectId: string, assetId: string) {
    void sponsorOwnerId;
    void projectId;
    void assetId;
    throw AppError.forbidden("Sponsors cannot access private footage.");
  }

  async readSubscriberAnalysis() {
    throw AppError.forbidden("Sponsors cannot access private analysis.");
  }
}
