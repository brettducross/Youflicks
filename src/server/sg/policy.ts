import { z } from "zod";
import {
  LANE_CLASSES,
  LOCKED_REGEN_CEILINGS,
  SG_MESSAGE_KEYS,
  attemptOutcomeSchema,
  gateStatusSchema,
  identityStateSchema,
  laneClassSchema,
  motionNeedSchema,
  routingModeSchema,
  routingScopeSchema,
  shotRoleSchema,
  type AttemptOutcome,
  type GateStatus,
  type LaneClass,
  type RoutingMode,
  type RoutingScope,
  type ShotRole,
  type Treatment,
} from "@/server/sg/constants";
import { E12_DIALOGUE_TREATMENT, DEFAULT_SG_ROUTING_MODE } from "@/server/sg/routing-mode";

/**
 * SG.4 routing policy (PR-8). Pure: no I/O.
 *
 * `decide` is the decision order. PR-3's unevaluated shell is replaced, not
 * wrapped. `SG_POLICY_CONTRACT_UNEVALUATED` is not a route. Seeing it means
 * fail closed: do not generate.
 *
 * PRESENT and UNKNOWN are not read as different routes. Callers pass the
 * same required scopes for both. `analysisCompleted` is not a cue field.
 */

export const SG_POLICY_CONTRACT_REASON = "SG_POLICY_CONTRACT_UNEVALUATED" as const;

const RESOLUTION_TIERS = ["480p", "720p", "768p", "1080p", "pro"] as const;

export const shotCuesSchema = z
  .object({
    requiredScopes: z.array(routingScopeSchema).min(1),
    shotRole: shotRoleSchema.optional(),
    identityState: identityStateSchema.optional(),
    originalCoversSlot: z.boolean().optional(),
    sourceStillExists: z.boolean().optional(),
    motionNeed: motionNeedSchema.nullable().optional(),
    routingMode: routingModeSchema.optional(),
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
    healthy: z.boolean().optional(),
    designation: z.enum(["NONE", "LEGACY_R1"]).optional(),
    resolutionTier: z.enum(RESOLUTION_TIERS).optional(),
    modelId: z.string().min(1).max(256).optional(),
    gates: z
      .object({
        HERO: gateStatusSchema,
        IDENTITY: gateStatusSchema,
        NON_IDENTITY: gateStatusSchema,
      })
      .strict(),
  })
  .strict();

const regenCeilingsSchema = z
  .object({
    "draft-cost": z.number().int().positive(),
    "draft-quality": z.number().int().positive(),
    standard: z.number().int().positive(),
    premium: z.number().int().positive(),
  })
  .strict();

export const registrySnapshotSchema = z
  .object({
    lanes: z.array(registryLaneSnapshotSchema),
    regenCeilings: regenCeilingsSchema.optional(),
    classOrder: z.array(laneClassSchema).min(1).optional(),
    registryUnavailable: z.boolean().optional(),
    unclassifiedAttemptCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export type RegistryLaneSnapshot = z.infer<typeof registryLaneSnapshotSchema>;
export type RegistrySnapshot = z.infer<typeof registrySnapshotSchema>;

/**
 * Cap flags are already resolved. Empty means no cap is blocking.
 * Remaining-number fields are not interpreted here (E9 stays in PR-1).
 */
export const budgetSnapshotSchema = z
  .object({
    projectBlocked: z.boolean().optional(),
    userBlocked: z.boolean().optional(),
    globalBlocked: z.boolean().optional(),
    laneBlocked: z.boolean().optional(),
  })
  .strict();

export type BudgetSnapshot = z.infer<typeof budgetSnapshotSchema>;

export const attemptSoFarSchema = z
  .object({
    laneClass: laneClassSchema,
    outcome: attemptOutcomeSchema,
    classAttemptNo: z.number().int().positive(),
  })
  .strict();

export type AttemptSoFar = z.infer<typeof attemptSoFarSchema>;

const generateDecisionSchema = z
  .object({
    treatment: z.literal("GENERATE"),
    laneClass: laneClassSchema,
    laneId: z.string().min(1).max(128),
    providerKey: z.string().min(1).max(256),
    decisionReason: z.string().min(1).max(240),
    messageKey: z.null(),
  })
  .strict();

const fallbackDecisionSchema = z
  .object({
    treatment: z.enum(["ORIGINAL", "KEN_BURNS", "STATIC", "REUSE", "DEFER", "FAIL_HONEST"]),
    laneClass: z.null(),
    laneId: z.null(),
    providerKey: z.null(),
    decisionReason: z.string().min(1).max(240),
    messageKey: z.string().min(1).max(64),
  })
  .strict();

/** GENERATE requires a lane. Every other treatment has no lane. Null is not persisted. */
export const routeDecisionSchema = z.union([generateDecisionSchema, fallbackDecisionSchema]);

export type RouteDecision = z.infer<typeof routeDecisionSchema>;

export type RoutePlan = {
  applied: RouteDecision;
  /** What ENFORCED would decide, including while the applied mode is LEGACY. */
  shadow: RouteDecision;
  /** Project or global cap, or a recorded CAP_DENIED. Stops the rest of the job. */
  stopJob: boolean;
  legacyModelId: string | null;
};

type ParsedCues = {
  requiredScopes: RoutingScope[];
  shotRole: ShotRole;
  identityState: "PRESENT" | "ABSENT" | "UNKNOWN";
  originalCoversSlot: boolean;
  sourceStillExists: boolean;
  motionNeed: "none" | "low" | "high" | null;
  routingMode: RoutingMode;
};

type ParsedLane = RegistryLaneSnapshot & {
  healthy: boolean;
  designation: "NONE" | "LEGACY_R1";
};

type ParsedRegistry = {
  lanes: ParsedLane[];
  regenCeilings: Record<LaneClass, number>;
  classOrder: LaneClass[];
  registryUnavailable: boolean;
  unclassifiedAttemptCount: number;
};

type ParsedBudget = {
  projectBlocked: boolean;
  userBlocked: boolean;
  globalBlocked: boolean;
  laneBlocked: boolean;
};

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

function fillCues(cues: ShotCues): ParsedCues {
  return {
    requiredScopes: cues.requiredScopes,
    shotRole: cues.shotRole ?? "other",
    identityState: cues.identityState ?? "UNKNOWN",
    originalCoversSlot: cues.originalCoversSlot ?? false,
    sourceStillExists: cues.sourceStillExists ?? false,
    motionNeed: cues.motionNeed ?? null,
    routingMode: cues.routingMode ?? DEFAULT_SG_ROUTING_MODE,
  };
}

function fillRegistry(snapshot: RegistrySnapshot): ParsedRegistry {
  return {
    lanes: snapshot.lanes.map((lane) => ({
      ...lane,
      healthy: lane.healthy ?? false,
      designation: lane.designation ?? "NONE",
    })),
    regenCeilings: snapshot.regenCeilings ?? { ...LOCKED_REGEN_CEILINGS },
    classOrder: snapshot.classOrder ? [...snapshot.classOrder] : [...LANE_CLASSES],
    registryUnavailable: snapshot.registryUnavailable ?? false,
    unclassifiedAttemptCount: snapshot.unclassifiedAttemptCount ?? 0,
  };
}

function fillBudget(snapshot: BudgetSnapshot): ParsedBudget {
  return {
    projectBlocked: snapshot.projectBlocked ?? false,
    userBlocked: snapshot.userBlocked ?? false,
    globalBlocked: snapshot.globalBlocked ?? false,
    laneBlocked: snapshot.laneBlocked ?? false,
  };
}

function decision(value: RouteDecision): RouteDecision {
  return routeDecisionSchema.parse(value);
}

function generate(lane: ParsedLane, decisionReason: string): RouteDecision {
  return decision({
    treatment: "GENERATE",
    laneClass: lane.laneClass,
    laneId: lane.laneId,
    providerKey: lane.providerKey,
    decisionReason,
    messageKey: null,
  });
}

function settled(
  treatment: Exclude<Treatment, "GENERATE">,
  decisionReason: string,
  messageKey: string,
): RouteDecision {
  return decision({
    treatment,
    laneClass: null,
    laneId: null,
    providerKey: null,
    decisionReason,
    messageKey,
  });
}

function stillOrDefer(
  cues: ParsedCues,
  decisionReason: string,
  messageKey: string,
): RouteDecision {
  if (!cues.sourceStillExists) {
    return settled("DEFER", decisionReason, messageKey);
  }
  if (cues.motionNeed === "none") {
    return settled("STATIC", decisionReason, messageKey);
  }
  return settled("KEN_BURNS", decisionReason, messageKey);
}

function isTbdProviderKey(providerKey: string): boolean {
  return /^\s*tbd\s*:/i.test(providerKey);
}

function identityBearing(scopes: readonly RoutingScope[]): boolean {
  return scopes.includes("HERO") || scopes.includes("IDENTITY");
}

function meetsResolutionFloor(lane: ParsedLane, scopes: readonly RoutingScope[]): boolean {
  if (!identityBearing(scopes)) {
    return true;
  }
  if (!lane.resolutionTier || lane.resolutionTier === "480p" || lane.resolutionTier === "pro") {
    return false;
  }
  return true;
}

/** Gate, health, resolution, and designation. Ceiling is applied by the caller. */
function laneReady(lane: ParsedLane, scopes: readonly RoutingScope[]): boolean {
  if (!lane.enabled || !lane.healthy || isTbdProviderKey(lane.providerKey)) {
    return false;
  }
  if (!scopes.every((scope) => lane.gates[scope] === "QUALIFIED")) {
    return false;
  }
  if (!meetsResolutionFloor(lane, scopes)) {
    return false;
  }
  if (identityBearing(scopes) && lane.designation === "LEGACY_R1") {
    return false;
  }
  return true;
}

/**
 * NON_IDENTITY locks to draft-cost. HERO and IDENTITY lock to the lowest
 * class that currently has a ready lane. -1 means no class is ready.
 */
function lockStartIndex(
  order: readonly LaneClass[],
  scopes: readonly RoutingScope[],
  registry: ParsedRegistry,
): number {
  if (identityBearing(scopes)) {
    return order.findIndex((laneClass) =>
      registry.lanes.some((lane) => lane.laneClass === laneClass && laneReady(lane, scopes)),
    );
  }
  return order.indexOf("draft-cost");
}

/**
 * Start is the lower of the lock start and the lowest class that holds a
 * non-CAP_DENIED attempt. History is used alone only when no class is ready,
 * and it can pin the start lower, never higher. Health and suspension do not
 * add a second escalation step. An empty class is not skipped.
 */
function startClassIndex(
  order: readonly LaneClass[],
  scopes: readonly RoutingScope[],
  registry: ParsedRegistry,
  attempts: readonly AttemptSoFar[],
): number {
  let historical = -1;
  for (const attempt of attempts) {
    if (attempt.outcome === "CAP_DENIED") {
      continue;
    }
    const index = order.indexOf(attempt.laneClass);
    if (index >= 0 && (historical < 0 || index < historical)) {
      historical = index;
    }
  }
  const lockStart = lockStartIndex(order, scopes, registry);
  if (lockStart < 0) {
    return historical;
  }
  if (historical < 0) {
    return lockStart;
  }
  return Math.min(lockStart, historical);
}

function classExhausted(
  laneClass: LaneClass,
  attempts: readonly AttemptSoFar[],
  ceilings: Record<LaneClass, number>,
): boolean {
  let max = 0;
  for (const attempt of attempts) {
    if (attempt.laneClass !== laneClass || attempt.outcome === "CAP_DENIED") {
      continue;
    }
    if (attempt.classAttemptNo > max) {
      max = attempt.classAttemptNo;
    }
  }
  return max >= ceilings[laneClass];
}

/**
 * Hard stop before another paid call. Cap, timeout, and cancel never escalate.
 * ENFORCED also refuses to overlap a PENDING attempt.
 * FAILED and REJECTED_TECHNICAL count toward the ceiling and can move one
 * class up. They are not a same-call retry: processJob records one attempt.
 */
export function blocksAutomaticPaidRetry(outcome: AttemptOutcome, mode: RoutingMode): boolean {
  if (outcome === "CAP_DENIED" || outcome === "TIMEOUT_UNRECONCILED" || outcome === "CANCELLED") {
    return true;
  }
  if (mode === "ENFORCED" && outcome === "PENDING") {
    return true;
  }
  return false;
}

function originalDecision(): RouteDecision {
  return settled(
    "ORIGINAL",
    "Original media covers the slot.",
    SG_MESSAGE_KEYS.FALLBACK_ORIGINAL,
  );
}

function dialogueDecision(cues: ParsedCues): RouteDecision {
  const e12 = E12_DIALOGUE_TREATMENT;
  if (e12 === "KEN_BURNS" || e12 === "STATIC") {
    if (!cues.sourceStillExists) {
      return settled(
        "DEFER",
        "E12 treatment needs a source still. Dialogue close-up is deferred.",
        SG_MESSAGE_KEYS.WAITING,
      );
    }
    return settled(
      e12,
      "E12 treatment for a dialogue close-up. Nothing is generated.",
      e12 === "STATIC" ? SG_MESSAGE_KEYS.FALLBACK_STATIC : SG_MESSAGE_KEYS.FALLBACK_KEN_BURNS,
    );
  }
  return settled(
    "DEFER",
    "Dialogue close-up is not generated while E12 is open.",
    SG_MESSAGE_KEYS.WAITING,
  );
}

function capDecision(): RouteDecision {
  return settled(
    "DEFER",
    "A spend cap was reached. No automatic retry.",
    SG_MESSAGE_KEYS.CAP_REACHED,
  );
}

function retryBlockedDecision(): RouteDecision {
  return settled(
    "DEFER",
    "No automatic retry after an unsettled, cancelled, or failed attempt.",
    SG_MESSAGE_KEYS.FAILED_HONEST,
  );
}

function legacyLane(registry: ParsedRegistry): ParsedLane | undefined {
  return registry.lanes.find(
    (lane) => lane.designation === "LEGACY_R1" && lane.enabled && !isTbdProviderKey(lane.providerKey),
  );
}

function legacyDecision(registry: ParsedRegistry): RouteDecision {
  const lane = legacyLane(registry);
  if (!lane) {
    return settled(
      "FAIL_HONEST",
      "LEGACY_R1 is not an enabled lane.",
      SG_MESSAGE_KEYS.FAILED_HONEST,
    );
  }
  return generate(lane, "LEGACY routes to the LEGACY_R1 lane.");
}

function budgetBlocked(budget: ParsedBudget): boolean {
  return budget.projectBlocked || budget.userBlocked || budget.globalBlocked || budget.laneBlocked;
}

function enforcedDecision(
  cues: ParsedCues,
  registry: ParsedRegistry,
  budget: ParsedBudget,
  attempts: readonly AttemptSoFar[],
): RouteDecision {
  if (attempts.some((attempt) => blocksAutomaticPaidRetry(attempt.outcome, "ENFORCED"))) {
    if (attempts.some((attempt) => attempt.outcome === "CAP_DENIED")) {
      return capDecision();
    }
    return retryBlockedDecision();
  }
  if (budgetBlocked(budget)) {
    return capDecision();
  }
  if (registry.registryUnavailable || registry.unclassifiedAttemptCount > 0) {
    const reason =
      registry.unclassifiedAttemptCount > 0
        ? "Unclassified attempts are counted conservatively. No lane is eligible."
        : "Lane registry is unavailable. No lane is eligible.";
    return stillOrDefer(cues, reason, SG_MESSAGE_KEYS.NO_QUALIFIED_LANE);
  }

  const scopes = cues.requiredScopes;
  const order = registry.classOrder;
  const startIndex = startClassIndex(order, scopes, registry, attempts);
  if (startIndex < 0) {
    return stillOrDefer(
      cues,
      "No eligible lane for the required scopes.",
      SG_MESSAGE_KEYS.NO_QUALIFIED_LANE,
    );
  }
  const start = order[startIndex]!;
  if (!classExhausted(start, attempts, registry.regenCeilings)) {
    const picked = registry.lanes.find(
      (lane) => lane.laneClass === start && laneReady(lane, scopes),
    );
    if (!picked) {
      return stillOrDefer(
        cues,
        "No eligible lane for the required scopes.",
        SG_MESSAGE_KEYS.NO_QUALIFIED_LANE,
      );
    }
    return generate(picked, `Eligible ${start} lane for the required scopes.`);
  }
  const next = order[startIndex + 1];
  if (!next || classExhausted(next, attempts, registry.regenCeilings)) {
    return stillOrDefer(cues, "Regen ceiling reached.", SG_MESSAGE_KEYS.CEILING_REACHED);
  }
  const escalated = registry.lanes.find((lane) => lane.laneClass === next && laneReady(lane, scopes));
  if (!escalated) {
    return stillOrDefer(cues, "Regen ceiling reached.", SG_MESSAGE_KEYS.CEILING_REACHED);
  }
  return generate(escalated, `Escalated one class to ${next} after the ceiling.`);
}

/**
 * Decision order from the lock. Same inputs always yield the same decision.
 * Does not read the network, the database, or the process environment.
 */
export function decide(
  cues: ShotCues,
  registrySnapshot: RegistrySnapshot,
  budgetSnapshot: BudgetSnapshot,
  attemptsSoFar: readonly AttemptSoFar[],
): RouteDecision {
  const parsedCues = fillCues(parseContract(shotCuesSchema, cues, "cues"));
  const registry = fillRegistry(parseContract(registrySnapshotSchema, registrySnapshot, "registrySnapshot"));
  const budget = fillBudget(parseContract(budgetSnapshotSchema, budgetSnapshot, "budgetSnapshot"));
  const attempts = parseContract(z.array(attemptSoFarSchema), attemptsSoFar, "attemptsSoFar");
  if (parsedCues.originalCoversSlot) {
    return originalDecision();
  }
  if (parsedCues.shotRole === "dialogue-closeup") {
    return dialogueDecision(parsedCues);
  }
  if (parsedCues.routingMode === "LEGACY") {
    return legacyDecision(registry);
  }
  return enforcedDecision(parsedCues, registry, budget, attempts);
}

export function planRoute(
  cues: ShotCues,
  registrySnapshot: RegistrySnapshot,
  budgetSnapshot: BudgetSnapshot,
  attemptsSoFar: readonly AttemptSoFar[],
): RoutePlan {
  const parsedCues = fillCues(parseContract(shotCuesSchema, cues, "cues"));
  const registry = fillRegistry(parseContract(registrySnapshotSchema, registrySnapshot, "registrySnapshot"));
  const budget = fillBudget(parseContract(budgetSnapshotSchema, budgetSnapshot, "budgetSnapshot"));
  const attempts = parseContract(z.array(attemptSoFarSchema), attemptsSoFar, "attemptsSoFar");
  const shadow = decide(
    { ...cues, routingMode: "ENFORCED" },
    registrySnapshot,
    budgetSnapshot,
    attemptsSoFar,
  );
  const applied =
    parsedCues.routingMode === "ENFORCED"
      ? shadow
      : decide({ ...cues, routingMode: "LEGACY" }, registrySnapshot, budgetSnapshot, attemptsSoFar);
  const stopJob =
    applied.messageKey === SG_MESSAGE_KEYS.CAP_REACHED &&
    (budget.projectBlocked || budget.globalBlocked || attempts.some((attempt) => attempt.outcome === "CAP_DENIED"));
  return {
    applied,
    shadow,
    stopJob,
    legacyModelId: legacyLane(registry)?.modelId ?? null,
  };
}

export function legacyModelGuard(input: {
  assetHttpModel: string | undefined;
  registryModelId: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const override = input.assetHttpModel?.trim() ?? "";
  if (override.length === 0 || !input.registryModelId) {
    return { ok: true };
  }
  if (override !== input.registryModelId) {
    return {
      ok: false,
      reason: "ASSET_HTTP_MODEL differs from the LEGACY_R1 registry modelId.",
    };
  }
  return { ok: true };
}

/** forLane is allowed only after eligibility selected this GENERATE lane. */
export function assertEnforcedLaneCallable(input: {
  laneId: string;
  eligibleLaneIds: readonly string[];
  decision: RouteDecision;
}): void {
  if (input.decision.treatment !== "GENERATE" || input.decision.laneId !== input.laneId) {
    throw new Error("forLane requires a GENERATE decision for that lane.");
  }
  if (!input.eligibleLaneIds.includes(input.laneId)) {
    throw new Error("forLane requires the lane to come from listEligibleLanes.");
  }
}

export function fulfillmentStatusForTreatment(treatment: Treatment): string | null {
  if (treatment === "GENERATE") {
    return null;
  }
  if (treatment === "DEFER") {
    return "DEFERRED";
  }
  if (treatment === "FAIL_HONEST") {
    return "FAILED";
  }
  return "FALLBACK";
}

export const SelectiveGenerationPolicy: SelectiveGenerationPolicy = {
  decide,
};

export type { AttemptOutcome, GateStatus, LaneClass, RoutingScope, Treatment };
