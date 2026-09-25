import { z } from "zod";
import {
  attemptOutcomeSchema,
  gateStatusSchema,
  laneClassSchema,
  routingScopeSchema,
  treatmentSchema,
  type AttemptOutcome,
  type GateStatus,
  type LaneClass,
  type RoutingScope,
  type Treatment,
} from "@/server/sg/constants";

/**
 * SG.0 policy contract (PR-3). Pure: no I/O and no lane selection.
 *
 * PR-8 owns the decision order. Until that slice lands, `decide` only
 * checks that its arguments use the locked vocabulary and returns an
 * unevaluated decision (no treatment, no lane). It is not wired into
 * Director, Story, Timeline, or asset fulfillment.
 */

export const shotCuesSchema = z
  .object({
    requiredScopes: z.array(routingScopeSchema).min(1),
  })
  .strict();

export type ShotCues = z.infer<typeof shotCuesSchema>;

export const registryLaneSnapshotSchema = z
  .object({
    laneId: z.string().min(1).max(128),
    laneClass: laneClassSchema,
    /** Open provenance string (D9). Not an enum. */
    providerKey: z.string().min(1).max(256),
    enabled: z.boolean(),
    gates: z
      .object({
        HERO: gateStatusSchema,
        IDENTITY: gateStatusSchema,
        NON_IDENTITY: gateStatusSchema,
      })
      .strict(),
  })
  .strict();

export const registrySnapshotSchema = z
  .object({
    lanes: z.array(registryLaneSnapshotSchema),
  })
  .strict();

export type RegistryLaneSnapshot = z.infer<typeof registryLaneSnapshotSchema>;
export type RegistrySnapshot = z.infer<typeof registrySnapshotSchema>;

/**
 * Already-resolved cap snapshot. This slice does not read the numbers (E9, PR-1, PR-8).
 * Values are numbers or null; an empty object means nothing is interpreted.
 */
export const budgetSnapshotSchema = z.record(z.string(), z.union([z.number(), z.null()]));

export type BudgetSnapshot = z.infer<typeof budgetSnapshotSchema>;

export const attemptSoFarSchema = z
  .object({
    laneClass: laneClassSchema,
    outcome: attemptOutcomeSchema,
    classAttemptNo: z.number().int().positive(),
  })
  .strict();

export type AttemptSoFar = z.infer<typeof attemptSoFarSchema>;

/** Null treatment and lane fields mean this contract has not selected a route. */
export const SG_POLICY_CONTRACT_REASON = "SG_POLICY_CONTRACT_UNEVALUATED" as const;

export const routeDecisionSchema = z
  .object({
    treatment: treatmentSchema.nullable(),
    laneClass: laneClassSchema.nullable(),
    laneId: z.string().min(1).max(128).nullable(),
    providerKey: z.string().min(1).max(256).nullable(),
    decisionReason: z.string().min(1).max(240),
  })
  .strict();

export type RouteDecision = z.infer<typeof routeDecisionSchema>;

export interface SelectiveGenerationPolicy {
  decide(
    cues: ShotCues,
    registrySnapshot: RegistrySnapshot,
    budgetSnapshot: BudgetSnapshot,
    attemptsSoFar: readonly AttemptSoFar[],
  ): RouteDecision;
}

function parseContract<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`SelectiveGenerationPolicy ${label} is outside the SG.0 contract.`);
  }
  return parsed.data;
}

/**
 * Pure contract check. Does not choose a lane, treatment, or provider.
 * Same inputs always yield the same unevaluated decision.
 */
export function decide(
  cues: ShotCues,
  registrySnapshot: RegistrySnapshot,
  budgetSnapshot: BudgetSnapshot,
  attemptsSoFar: readonly AttemptSoFar[],
): RouteDecision {
  parseContract(shotCuesSchema, cues, "cues");
  parseContract(registrySnapshotSchema, registrySnapshot, "registrySnapshot");
  parseContract(budgetSnapshotSchema, budgetSnapshot, "budgetSnapshot");
  parseContract(z.array(attemptSoFarSchema), attemptsSoFar, "attemptsSoFar");
  return {
    treatment: null,
    laneClass: null,
    laneId: null,
    providerKey: null,
    decisionReason: SG_POLICY_CONTRACT_REASON,
  };
}

export const SelectiveGenerationPolicy: SelectiveGenerationPolicy = {
  decide,
};

export type { AttemptOutcome, GateStatus, LaneClass, RoutingScope, Treatment };
