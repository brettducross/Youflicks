import {
  FREE_MAX_OUTPUT_DURATION_MS,
  FREE_MOVIE_GENERATIONS_PER_HOUR,
} from "@/server/entitlement/types";
import { PlanKey, type PlanGrantShape } from "@/server/billing/types";

/**
 * FREE / PLUS / FAMILY grant shapes.
 * FREE numeric benefits are Constitution-locked.
 * PLUS / FAMILY flags are locked; numeric caps and prices stay null/TBD.
 */
export const PLAN_GRANT_SHAPES: Record<(typeof PlanKey)[keyof typeof PlanKey], PlanGrantShape> =
  {
    [PlanKey.FREE]: {
      planKey: PlanKey.FREE,
      displayName: "Free",
      watermarkRequired: true,
      adsEnabled: true,
      movieGenerationsPerHour: FREE_MOVIE_GENERATIONS_PER_HOUR,
      maxOutputDurationMs: FREE_MAX_OUTPUT_DURATION_MS,
      storageBytes: null,
      processingPriority: null,
      familyProfiles: false,
      sharedLibrary: false,
      parentalControls: false,
      collaboration: false,
      priceAmount: null,
      priceCurrency: null,
    },
    [PlanKey.PLUS]: {
      planKey: PlanKey.PLUS,
      displayName: "Plus",
      watermarkRequired: false,
      adsEnabled: false,
      movieGenerationsPerHour: null,
      maxOutputDurationMs: null,
      storageBytes: null,
      processingPriority: null,
      familyProfiles: false,
      sharedLibrary: false,
      parentalControls: false,
      collaboration: false,
      priceAmount: null,
      priceCurrency: null,
    },
    [PlanKey.FAMILY]: {
      planKey: PlanKey.FAMILY,
      displayName: "Family",
      watermarkRequired: false,
      adsEnabled: false,
      movieGenerationsPerHour: null,
      maxOutputDurationMs: null,
      storageBytes: null,
      processingPriority: null,
      familyProfiles: true,
      sharedLibrary: true,
      parentalControls: true,
      collaboration: true,
      priceAmount: null,
      priceCurrency: null,
    },
  };

export function planGrantShape(planKey: string): PlanGrantShape | null {
  if (planKey === PlanKey.FREE || planKey === PlanKey.PLUS || planKey === PlanKey.FAMILY) {
    return PLAN_GRANT_SHAPES[planKey];
  }
  return null;
}

export function planOfferKey(planKey: string): string {
  return `plan.${planKey.toLowerCase()}`;
}
