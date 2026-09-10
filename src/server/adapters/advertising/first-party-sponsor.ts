import {
  ALLOWED_AD_SURFACES,
  CommercialPlacement,
  CommercialSurface,
  FIRST_PARTY_AD_PROVIDER_KEY,
  IN_MOVIE_SURFACE,
  type AdvertisingSurfaceView,
  type CommercialSurfaceValue,
} from "@/server/advertising/types";
import { PlacementStatus, SponsorPlacementKind } from "@/server/domain/personalization";
import { prisma } from "@/server/db";

const SURFACE_PLACEMENT_KINDS: Record<string, string[]> = {
  [CommercialSurface.UI_SHELL]: [
    SponsorPlacementKind.LOGO,
    SponsorPlacementKind.FEATURED_LOGO,
  ],
  [CommercialSurface.POST_FILM]: [SponsorPlacementKind.SPONSORED_END_CARD],
  [CommercialSurface.LIBRARY_BANNER]: [
    SponsorPlacementKind.LOGO,
    SponsorPlacementKind.FEATURED_LOGO,
  ],
  [CommercialSurface.FILM_CREDITS]: [
    SponsorPlacementKind.CREDIT_ONLY,
    SponsorPlacementKind.ANIMATED_CREDIT,
  ],
};

const SURFACE_COPY: Record<string, string> = {
  [CommercialSurface.UI_SHELL]:
    "A YouFlicks first-party sponsor appears on the app shell — not inside your movie.",
  [CommercialSurface.POST_FILM]:
    "A YouFlicks first-party sponsor appears after the film, not in the cut.",
  [CommercialSurface.LIBRARY_BANNER]:
    "A YouFlicks first-party sponsor appears on the library chrome — not inside a film.",
  [CommercialSurface.FILM_CREDITS]:
    "An approved sponsor credit appears in FilmCredits after the film.",
};

/**
 * First-party / direct sponsor serve. Allowed surfaces only.
 * IN_MOVIE is always empty. Never calls AiDirectorPort.
 */
export class FirstPartySponsorAdapter {
  async fetchCreative(
    surface: string,
    context: { projectId?: string } = {},
  ): Promise<AdvertisingSurfaceView | null> {
    if (surface === IN_MOVIE_SURFACE) {
      return null;
    }
    if (!ALLOWED_AD_SURFACES.includes(surface as CommercialSurfaceValue)) {
      return null;
    }

    if (surface === CommercialSurface.FILM_CREDITS) {
      return this.fetchApprovedFilmCredits(context.projectId);
    }

    const kinds = SURFACE_PLACEMENT_KINDS[surface];
    if (!kinds) {
      return null;
    }
    const offer = await prisma.sponsorOffer.findFirst({
      where: {
        placementKind: { in: kinds },
        campaign: { status: "ACTIVE" },
      },
      include: { campaign: { include: { sponsor: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (!offer) {
      return null;
    }
    return {
      key: surface as CommercialSurfaceValue,
      placement: placementFor(surface),
      kind: "FIRST_PARTY",
      copy: SURFACE_COPY[surface] ?? SURFACE_COPY[CommercialSurface.UI_SHELL],
      displayName: offer.displayName,
      linkUrl: offer.linkUrl,
      providerKey: FIRST_PARTY_AD_PROVIDER_KEY,
      campaignId: offer.campaignId,
      offerId: offer.id,
    };
  }

  private async fetchApprovedFilmCredits(
    projectId?: string,
  ): Promise<AdvertisingSurfaceView | null> {
    if (!projectId) {
      return null;
    }
    const placement = await prisma.sponsorPlacement.findFirst({
      where: {
        projectId,
        status: PlacementStatus.APPROVED,
        offer: {
          placementKind: { in: SURFACE_PLACEMENT_KINDS[CommercialSurface.FILM_CREDITS] },
        },
      },
      include: { offer: { include: { campaign: { include: { sponsor: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    if (!placement) {
      return null;
    }
    return {
      key: CommercialSurface.FILM_CREDITS,
      placement: CommercialPlacement.FILM_CREDITS,
      kind: "FIRST_PARTY",
      copy: SURFACE_COPY[CommercialSurface.FILM_CREDITS],
      displayName: placement.offer.displayName,
      linkUrl: placement.offer.linkUrl,
      providerKey: FIRST_PARTY_AD_PROVIDER_KEY,
      campaignId: placement.offer.campaignId,
      offerId: placement.offer.id,
    };
  }
}

function placementFor(surface: string) {
  if (surface === CommercialSurface.POST_FILM) {
    return CommercialPlacement.POST_FILM;
  }
  if (surface === CommercialSurface.FILM_CREDITS) {
    return CommercialPlacement.FILM_CREDITS;
  }
  return CommercialPlacement.SHELL;
}
