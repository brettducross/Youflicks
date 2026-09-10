import type { UsageDebitIntent } from "@/server/billing/types";

/**
 * Maps usage / engine cost → credit debit quantity.
 *
 * Coefficients come from config only. This module must not hard-code
 * 1 credit = 1 movie / 1 MOVIE_GENERATION / 1 AI_DIRECT.
 * Default coefficients are null (TBD) until PO supplies them after telemetry.
 */
export type UsageCreditPolicyConfig = {
  /** Credits per EngineCostEvent cost unit. Null = TBD — do not invent. */
  creditsPerCostUnit: number | null;
  /**
   * Optional per-kind credits per usage quantity, used only when cost units
   * are absent and a coefficient is configured. Empty by default.
   */
  creditsPerUsageQuantity: Record<string, number | null>;
};

export const DEFAULT_USAGE_CREDIT_POLICY: UsageCreditPolicyConfig = {
  creditsPerCostUnit: null,
  creditsPerUsageQuantity: {},
};

export type UsageCreditPolicy = (
  intent: UsageDebitIntent,
  config?: UsageCreditPolicyConfig,
) => number | null;

export function debitQuantityForUsage(
  intent: UsageDebitIntent,
  config: UsageCreditPolicyConfig = DEFAULT_USAGE_CREDIT_POLICY,
): number | null {
  if (intent.costUnits != null && config.creditsPerCostUnit != null) {
    return Math.max(0, intent.costUnits) * config.creditsPerCostUnit;
  }
  const kindCoefficient = config.creditsPerUsageQuantity[intent.kind];
  if (kindCoefficient != null) {
    return Math.max(0, intent.quantity) * kindCoefficient;
  }
  return null;
}
