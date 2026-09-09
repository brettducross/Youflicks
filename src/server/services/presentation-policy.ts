import "server-only";

import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import type { AdvertisingSurfaceView, AdsHonesty } from "@/server/advertising/types";
import type { EntitlementSummary } from "@/server/entitlement/types";
import type { WatermarkChromeView } from "@/server/watermark/types";
import { AdvertisingService } from "@/server/services/advertising";
import { EntitlementService } from "@/server/services/entitlement";
import { WatermarkPolicyService } from "@/server/services/watermark-policy";

export type PresentationPolicyView = {
  watermarkRequired: boolean;
  watermark: WatermarkChromeView;
  adsEnabled: boolean;
  ads: AdvertisingSurfaceView[];
  adsHonesty: AdsHonesty;
  entitlementSummary: EntitlementSummary;
};

/**
 * Compose entitlement flags into playback / library / shell chrome.
 * Platform envelope only — never written into CreativePlan or PlaybackPort sessions.
 */
export class PresentationPolicyService {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly watermark: WatermarkPolicyService,
    private readonly advertising: AdvertisingService,
  ) {}

  async forUser(userId: string, projectId?: string): Promise<PresentationPolicyView> {
    const [constraints, entitlementSummary] = await Promise.all([
      this.entitlements.policyConstraints(userId, projectId),
      this.entitlements.getEntitlementSummary(userId),
    ]);
    const decision = this.watermark.decide(constraints);
    const ads = constraints.adsEnabled
      ? await this.advertising.eligibleSurfaces(userId)
      : [];
    return {
      watermarkRequired: decision.required,
      watermark: this.watermark.chrome(decision),
      adsEnabled: constraints.adsEnabled,
      ads,
      adsHonesty: this.advertising.honestyFrom(constraints),
      entitlementSummary,
    };
  }

  async forProjectOwner(projectId: string): Promise<PresentationPolicyView> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project) {
      throw AppError.notFound("That project was not found.");
    }
    return this.forUser(project.ownerId, projectId);
  }
}
