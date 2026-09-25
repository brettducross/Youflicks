import { AppError } from "@/lib/errors";
import {
  CREATIVE_PLAN_SCHEMA_VERSION,
  creativePlanSchema,
  type CreativePlan,
} from "@/server/director/schema";
import type { DirectorInput } from "@/server/director/input";
import { SG_ROUTING_PLAN_KEYS } from "@/server/sg/constants";

const COMMERCIAL_PLAN_KEYS = new Set([
  "planKind",
  "planKey",
  "credits",
  "remainingCredits",
  "creditLedger",
  "creditBalance",
  "subscription",
  "prepaid",
  "billingPort",
  "offerKey",
  "packKey",
  "paymentEvent",
  "engineCost",
  "costUnits",
  "usageEvent",
  "billing",
  "invoice",
  "adsEnabled",
  "watermarkRequired",
  "advertising",
  "watermarkPolicy",
  "advertisingPort",
]);

const ROUTING_PLAN_KEYS = new Set<string>(SG_ROUTING_PLAN_KEYS);

export function validateCreativePlan(raw: unknown): CreativePlan {
  const parsed = creativePlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.directorPlanInvalid("Creative plan does not match the YouFlicks schema.", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  assertNoCommercialPlanFields(parsed.data);
  assertNoRoutingPlanFields(parsed.data);
  return parsed.data;
}

/** Entitlements are platform gates — never CreativePlan meaning. */
export function assertNoCommercialPlanFields(plan: CreativePlan) {
  const hits: string[] = [];
  walkDeniedPlanKeys(plan, "plan", hits, []);
  if (hits.length > 0) {
    throw AppError.directorPlanInvalid(
      "Creative plans must not include commercial entitlement or engine-cost fields.",
      { paths: hits },
    );
  }
}

/**
 * Routing economics stay on the fulfillment side (§5.1).
 * Write path only: reads keep passthrough bytes so stored plans and fingerprints stay stable.
 */
export function assertNoRoutingPlanFields(plan: CreativePlan) {
  const hits: string[] = [];
  walkDeniedPlanKeys(plan, "plan", [], hits);
  if (hits.length > 0) {
    throw AppError.directorPlanInvalid(
      "Creative plans must not include routing or fulfillment-economics fields.",
      { paths: hits },
    );
  }
}

function walkDeniedPlanKeys(
  value: unknown,
  path: string,
  commercialHits: string[],
  routingHits: string[],
) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkDeniedPlanKeys(item, `${path}[${index}]`, commercialHits, routingHits),
    );
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (COMMERCIAL_PLAN_KEYS.has(key)) {
      commercialHits.push(childPath);
    }
    if (ROUTING_PLAN_KEYS.has(key)) {
      routingHits.push(childPath);
    }
    walkDeniedPlanKeys(child, childPath, commercialHits, routingHits);
  }
}

export function assertPlanSchemaVersion(plan: CreativePlan) {
  if (plan.schemaVersion !== CREATIVE_PLAN_SCHEMA_VERSION) {
    throw AppError.directorPlanInvalid("Unsupported creative plan schema version.", {
      schemaVersion: plan.schemaVersion,
    });
  }
}

/**
 * Architectural check only. Does not generate a plan.
 * Flags an obvious conflict: explicit duration vs a plan that claims none
 * when the project required one. Future Director implementations expand this.
 */
export function assertPlanRespectsConstraints(input: DirectorInput, plan: CreativePlan) {
  const required = input.constraints.desiredDurationMs;
  if (required && plan.constraints?.some((item) => item === "ignore_duration")) {
    throw AppError.directorConstraintConflict(
      "The plan ignores a duration the project required.",
    );
  }
}

export function assertNoInventedConfidence(plan: CreativePlan) {
  const blob = JSON.stringify(plan);
  if (/"confidence"\s*:/.test(blob)) {
    throw AppError.directorPlanInvalid("Creative plans must not invent confidence values.");
  }
}
