import { z } from "zod";

/**
 * SG.0 policy vocabulary (D3, D9). Open strings in the database;
 * closed here in app code. Adding a value is additive and needs no enum migration.
 */

/** D3. Unknown identity maps to IDENTITY in cue extraction (PR-6), not in this list. */
export const ROUTING_SCOPES = ["HERO", "IDENTITY", "NON_IDENTITY"] as const;
export type RoutingScope = (typeof ROUTING_SCOPES)[number];
export const routingScopeSchema = z.enum(ROUTING_SCOPES);

/** PR-4 classOrder. Draft-cost is the only class whose ceiling is 3 (D6). */
export const LANE_CLASSES = ["draft-cost", "draft-quality", "standard", "premium"] as const;
export type LaneClass = (typeof LANE_CLASSES)[number];
export const laneClassSchema = z.enum(LANE_CLASSES);

/**
 * Fulfillment treatment vocabulary from the lock (ShotFulfillment.treatment).
 * Generic creative word `treatment` is not this set and is not a plan denylist key.
 */
export const TREATMENTS = [
  "ORIGINAL",
  "KEN_BURNS",
  "STATIC",
  "REUSE",
  "GENERATE",
  "DEFER",
  "FAIL_HONEST",
] as const;
export type Treatment = (typeof TREATMENTS)[number];
export const treatmentSchema = z.enum(TREATMENTS);

export const GATE_STATUSES = ["NOT_QUALIFIED", "QUALIFIED", "SUSPENDED"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];
export const gateStatusSchema = z.enum(GATE_STATUSES);

/** ShotFulfillmentAttempt.outcome. Not a Prisma enum (D9). */
export const ATTEMPT_OUTCOMES = [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CAP_DENIED",
  "TIMEOUT_UNRECONCILED",
  "CANCELLED",
  "REJECTED_TECHNICAL",
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];
export const attemptOutcomeSchema = z.enum(ATTEMPT_OUTCOMES);

/** ShotFulfillment.status. Open string in the database (D9). */
export const FULFILLMENT_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "FULFILLED",
  "FALLBACK",
  "DEFERRED",
  "FAILED",
  "SUPERSEDED",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];
export const fulfillmentStatusSchema = z.enum(FULFILLMENT_STATUSES);

/** ShotFulfillment.identityState. UNKNOWN counts as IDENTITY (D3). */
export const IDENTITY_STATES = ["PRESENT", "ABSENT", "UNKNOWN"] as const;
export type IdentityState = (typeof IDENTITY_STATES)[number];
export const identityStateSchema = z.enum(IDENTITY_STATES);

/**
 * ShotFulfillment.shotRole. Cue vocabulary from the lock (PR-6).
 * Not a Prisma enum (D9).
 */
export const SHOT_ROLES = [
  "hero",
  "establishing",
  "insert",
  "transition",
  "dialogue-closeup",
  "other",
] as const;
export type ShotRole = (typeof SHOT_ROLES)[number];
export const shotRoleSchema = z.enum(SHOT_ROLES);

/** ShotFulfillment.motionNeed. Cue only; not a routing decision. */
export const MOTION_NEEDS = ["none", "low", "high"] as const;
export type MotionNeed = (typeof MOTION_NEEDS)[number];
export const motionNeedSchema = z.enum(MOTION_NEEDS);

/**
 * ShotFulfillment.routingMode (D12).
 * The shipped default lives in `routing-mode.ts` (`DEFAULT_SG_ROUTING_MODE`).
 * E-R1 is still open. Do not add a second default.
 */
export const ROUTING_MODES = ["LEGACY", "ENFORCED"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];
export const routingModeSchema = z.enum(ROUTING_MODES);

/**
 * CreativePlan JSON keys rejected on the write path only (§5.1).
 * `cost` and `treatment` are omitted on purpose so creative prose keys still pass.
 */
export const SG_ROUTING_PLAN_KEYS = [
  "laneClass",
  "laneId",
  "providerKey",
  "routingScope",
  "requiredScopes",
  "treatmentClass",
  "gateStatus",
  "usdPerSecond",
  "usdPerS",
  "billedSeconds",
  "reservedUsd",
  "estimatedUsd",
  "regenCeiling",
  "spendCapUsd",
  "aiVideoSeconds",
] as const;

export type SgRoutingPlanKey = (typeof SG_ROUTING_PLAN_KEYS)[number];

/**
 * CreativePlan write-path denylist (lock r3 A1, §5.1).
 * Exact key names only. `cost` stays off this list.
 * Must be enforced before SG_ROUTING_MODE=ENFORCED is enabled.
 */
export const SG_COST_PLAN_KEYS = [
  "actualUsd",
  "spendUsd",
  "committedUsd",
  "unreconciledUsd",
  "actualBilledSeconds",
  "estimatedBilledSeconds",
  "reservedSeconds",
  "committedSeconds",
  "unreconciledBilledSeconds",
  "reservedBilledSeconds",
  "costKind",
  "usd",
] as const;

export type SgCostPlanKey = (typeof SG_COST_PLAN_KEYS)[number];

/** SG.6 keys recorded on a non-GENERATE decision. PR-10 owns the user-facing copy. */
export const SG_MESSAGE_KEYS = {
  FALLBACK_ORIGINAL: "SG_FALLBACK_ORIGINAL",
  FALLBACK_KEN_BURNS: "SG_FALLBACK_KEN_BURNS",
  FALLBACK_STATIC: "SG_FALLBACK_STATIC",
  NO_QUALIFIED_LANE: "SG_NO_QUALIFIED_LANE",
  CEILING_REACHED: "SG_CEILING_REACHED",
  WAITING: "SG_WAITING",
  CAP_REACHED: "SG_CAP_REACHED",
  FAILED_HONEST: "SG_FAILED_HONEST",
} as const;

export type SgMessageKey = (typeof SG_MESSAGE_KEYS)[keyof typeof SG_MESSAGE_KEYS];

/** D6. Draft-cost is 3. Every other class is 2. Config may override per registry snapshot. */
export const LOCKED_REGEN_CEILINGS = {
  "draft-cost": 3,
  "draft-quality": 2,
  standard: 2,
  premium: 2,
} as const;
