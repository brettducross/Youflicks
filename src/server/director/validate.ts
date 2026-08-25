import { AppError } from "@/lib/errors";
import {
  CREATIVE_PLAN_SCHEMA_VERSION,
  creativePlanSchema,
  type CreativePlan,
} from "@/server/director/schema";
import type { DirectorInput } from "@/server/director/input";

export function validateCreativePlan(raw: unknown): CreativePlan {
  const parsed = creativePlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.directorPlanInvalid("Creative plan does not match the YouFlicks schema.", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  return parsed.data;
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
