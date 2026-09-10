import "server-only";

import { logger } from "@/lib/logger";
import { allowlistedHttpsLinkUrl } from "@/server/advertising/link-url";
import { CreditType, PlacementStatus, SponsorPlacementKind } from "@/server/domain/personalization";
import { prisma } from "@/server/db";
import type { FilmCreditLineView, FilmCreditsView } from "@/server/personalization/views";
import { AttributionService } from "@/server/services/attribution";
import { ProjectService } from "@/server/services/projects";
import { SponsorshipService } from "@/server/services/sponsorship";
import { TasteService } from "@/server/services/taste";

/**
 * Credits Builder.
 *
 * Film → Provider Attribution → Credits Builder → Sponsorship Eligibility → Film Credits
 *
 * Does not import a renderer. Does not read taste. Sponsors only contribute
 * approved post-film presentation lines when the subscriber opted in.
 */
export class CreditsService {
  constructor(
    private readonly projects: ProjectService = new ProjectService(),
    private readonly attribution: AttributionService = new AttributionService(),
    private readonly taste: TasteService = new TasteService(),
    private readonly sponsorship: SponsorshipService = new SponsorshipService(),
  ) {}

  toLineView(row: {
    id: string;
    displayName: string;
    providerKey: string | null;
    creditType: string;
    displayOrder: number;
    logoKey: string | null;
    audioKey: string | null;
    videoKey: string | null;
    linkUrl: string | null;
  }): FilmCreditLineView {
    return {
      id: row.id,
      displayName: row.displayName,
      providerKey: row.providerKey,
      creditType: row.creditType,
      displayOrder: row.displayOrder,
      logoKey: row.logoKey,
      audioKey: row.audioKey,
      videoKey: row.videoKey,
      linkUrl: allowlistedHttpsLinkUrl(row.linkUrl),
    };
  }

  toView(row: {
    id: string;
    projectId: string;
    movieId: string | null;
    status: string;
    createdAt: Date;
    lines: Parameters<CreditsService["toLineView"]>[0][];
  }): FilmCreditsView {
    return {
      id: row.id,
      projectId: row.projectId,
      movieId: row.movieId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      lines: row.lines
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((line) => this.toLineView(line)),
    };
  }

  async getLatest(userId: string, projectId: string) {
    await this.projects.getForUser(userId, projectId);
    const row = await prisma.filmCredits.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { lines: { orderBy: { displayOrder: "asc" } } },
    });
    return row ? this.toView(row) : null;
  }

  async buildForProject(userId: string, projectId: string) {
    await this.projects.getForUser(userId, projectId);
    const [attributions, prefs, approved] = await Promise.all([
      this.attribution.listForProject(userId, projectId),
      this.taste.getSponsorshipPreferences(userId, userId),
      this.sponsorship.listApprovedForProject(projectId),
    ]);

    const lines: Array<{
      displayName: string;
      providerKey?: string | null;
      creditType: string;
      displayOrder: number;
      logoKey?: string | null;
      audioKey?: string | null;
      videoKey?: string | null;
      linkUrl?: string | null;
    }> = [
      {
        displayName: "YouFlicks",
        creditType: CreditType.YOUFLICKS,
        displayOrder: 0,
      },
    ];

    const seenProviders = new Set<string>();
    let order = 10;
    for (const item of attributions) {
      const key = `${item.providerKey}:${item.capability}`;
      if (seenProviders.has(key)) continue;
      seenProviders.add(key);
      lines.push({
        displayName: item.providerKey,
        providerKey: item.providerKey,
        creditType: creditTypeForCapability(item.capability),
        displayOrder: order,
      });
      order += 10;
    }

    if (prefs.allowSponsorCredits) {
      for (const placement of approved) {
        const offer = placement.offer;
        if (!isCreditEligibleKind(offer.placementKind)) continue;
        lines.push({
          displayName: offer.displayName,
          creditType: CreditType.SPONSOR,
          displayOrder: order,
          logoKey: offer.logoKey,
          audioKey: offer.audioKey,
          videoKey: offer.videoKey,
          linkUrl: allowlistedHttpsLinkUrl(offer.linkUrl),
        });
        order += 10;
        await prisma.sponsorPlacement.update({
          where: { id: placement.id },
          data: { status: PlacementStatus.APPLIED },
        });
      }
    }

    const row = await prisma.filmCredits.create({
      data: {
        projectId,
        status: "READY",
        lines: {
          create: lines.map((line) => ({
            displayName: line.displayName,
            providerKey: line.providerKey ?? null,
            creditType: line.creditType,
            displayOrder: line.displayOrder,
            logoKey: line.logoKey ?? null,
            audioKey: line.audioKey ?? null,
            videoKey: line.videoKey ?? null,
            linkUrl: line.linkUrl ?? null,
          })),
        },
      },
      include: { lines: { orderBy: { displayOrder: "asc" } } },
    });

    logger.info("credits.built", {
      userId,
      projectId,
      lineCount: row.lines.length,
      sponsorLines: row.lines.filter((line) => line.creditType === CreditType.SPONSOR).length,
    });
    return this.toView(row);
  }
}

function creditTypeForCapability(capability: string) {
  if (capability === "TRANSCRIPTION") return CreditType.TRANSCRIPTION_PROVIDER;
  if (capability === "AUDIO_ANALYSIS") return CreditType.VOICE_PROVIDER;
  return CreditType.ANALYSIS_PROVIDER;
}

function isCreditEligibleKind(kind: string) {
  return (
    kind === SponsorPlacementKind.CREDIT_ONLY ||
    kind === SponsorPlacementKind.LOGO ||
    kind === SponsorPlacementKind.FEATURED_LOGO ||
    kind === SponsorPlacementKind.ANIMATED_CREDIT
  );
}
