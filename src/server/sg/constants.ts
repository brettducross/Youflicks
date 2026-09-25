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
