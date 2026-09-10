import { prisma } from "@/server/db";
import { planGrantShape } from "@/server/billing/plan-catalog";
import { SubscriptionStatus } from "@/server/billing/types";
import type { PrepaidResolver, SubscriptionResolver } from "@/server/entitlement/resolvers";
import type { PrepaidGrant, SubscriptionGrant } from "@/server/entitlement/types";
import { availableCreditBalance } from "@/server/billing/ledger";

/**
 * Fills EntitlementService.mergeSnapshot only.
 * Does not run checkout, invent prices, or write CreativePlan.
 */
export class BillingSubscriptionResolver implements SubscriptionResolver {
  async resolve(userId: string): Promise<SubscriptionGrant[]> {
    const rows = await prisma.subscription.findMany({
      where: { userId, status: SubscriptionStatus.ACTIVE },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => grantFromPlanKey(row.planKey));
  }
}

export class BillingPrepaidResolver implements PrepaidResolver {
  async resolve(userId: string): Promise<PrepaidGrant[]> {
    const remainingCredits = await availableCreditBalance(userId);
    if (remainingCredits <= 0) {
      return [];
    }
    return [{ remainingCredits }];
  }
}

export function grantFromPlanKey(planKey: string): SubscriptionGrant {
  const shape = planGrantShape(planKey);
  if (!shape) {
    return { planKey };
  }
  const grant: SubscriptionGrant = {
    planKey: shape.planKey,
    watermarkRequired: shape.watermarkRequired,
    adsEnabled: shape.adsEnabled,
  };
  if (shape.movieGenerationsPerHour != null) {
    grant.movieGenerationsPerHour = shape.movieGenerationsPerHour;
  }
  if (shape.maxOutputDurationMs != null) {
    grant.maxOutputDurationMs = shape.maxOutputDurationMs;
  }
  return grant;
}
