import {
  DEFAULT_SG_LANE_REGISTRY_PATH,
  LaneRegistryError,
  isTbdProviderKey,
  loadSgLaneRegistry,
  type RegistryLane,
} from "@/server/sg/lane-registry";

/** Open strings validated here. Not Prisma enums. */
export const GATEWAY_LEDGER_SCOPE_KINDS = ["GLOBAL", "LANE", "BAKEOFF", "BAKEOFF_CELL"] as const;
export type GatewayLedgerScopeKind = (typeof GATEWAY_LEDGER_SCOPE_KINDS)[number];

export const RESERVATION_STATUSES = ["RESERVED", "RECONCILED", "RELEASED", "UNRECONCILED"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const AI_VIDEO_BUDGET_SCOPE_KINDS = ["PROJECT", "USER_WINDOW"] as const;
export type AiVideoBudgetScopeKind = (typeof AI_VIDEO_BUDGET_SCOPE_KINDS)[number];

export { DEFAULT_SG_LANE_REGISTRY_PATH, LaneRegistryError };
export type { RegistryLane };

/** Rate fields the gateway prices from. The full lane lives on RegistryLane. */
export type LaneRate = {
  laneId: string;
  providerKey: string;
  usdPerSecond: number;
  clipDurationS: number;
  supportedDurationsS: number[];
  billingGranularityS: number;
  failuresBillable: boolean;
  rateRef: string;
};

export class LaneDurationError extends Error {
  readonly code = "DURATION_UNSUPPORTED";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "LaneDurationError";
  }
}

export type LaneChargeEstimate = {
  requestedDurationS: number;
  estimatedBilledSeconds: number;
  reservedUsd: number;
};

export function scopeKindForLedgerId(id: string): GatewayLedgerScopeKind {
  if (id.startsWith("bakeoff:") && id.includes(":cell:")) {
    return "BAKEOFF_CELL";
  }
  if (id.startsWith("bakeoff:")) {
    return "BAKEOFF";
  }
  if (id.startsWith("lane:")) {
    return "LANE";
  }
  return "GLOBAL";
}

export function laneLedgerId(laneId: string): string {
  return `lane:${laneId}`;
}

/** Ledger rows a gateway process charges, sorted for lock order. */
export function gatewayChargeLedgerIds(primaryLedgerId: string, laneId: string): string[] {
  return [...new Set([primaryLedgerId, laneLedgerId(laneId)])].sort();
}

export function roundUpToGranularity(value: number, granularityS: number): number {
  if (!(granularityS > 0) || !Number.isFinite(granularityS)) {
    throw new LaneRegistryError("billingGranularityS must be a positive number.");
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new LaneRegistryError("Duration must be a finite non-negative number.");
  }
  const steps = Math.ceil((value - 1e-9) / granularityS);
  return roundMeasure(steps * granularityS);
}

export function roundMeasure(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/**
 * D_req = requested duration when numeric, otherwise the lane clip length.
 * D_bill = smallest supported duration ≥ D_req, rounded up to billingGranularityS.
 * D_req above every supported duration is rejected (gateway 400).
 */
export function estimateLaneCharge(lane: LaneRate, requestedDurationS?: number): LaneChargeEstimate {
  const dReq = requestedDurationS ?? lane.clipDurationS;
  if (!Number.isFinite(dReq) || dReq <= 0) {
    throw new LaneDurationError("Requested duration must be a positive number of seconds.");
  }
  const supported = [...lane.supportedDurationsS].sort((a, b) => a - b);
  const max = supported[supported.length - 1]!;
  if (dReq > max) {
    throw new LaneDurationError(
      `Requested duration ${dReq}s exceeds the lane maximum of ${max}s.`,
    );
  }
  const base = supported.find((duration) => duration + 1e-9 >= dReq);
  if (base === undefined) {
    throw new LaneDurationError(
      `Requested duration ${dReq}s is not covered by the lane's supported durations.`,
    );
  }
  const estimatedBilledSeconds = roundUpToGranularity(base, lane.billingGranularityS);
  return {
    requestedDurationS: dReq,
    estimatedBilledSeconds,
    reservedUsd: roundMeasure(estimatedBilledSeconds * lane.usdPerSecond),
  };
}

export function actualBilledSecondsFromDurationMs(
  durationMs: number | undefined,
  granularityS: number,
  estimateS: number,
): { seconds: number; flagged: boolean } {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { seconds: estimateS, flagged: true };
  }
  return {
    seconds: roundUpToGranularity(durationMs / 1000, granularityS),
    flagged: false,
  };
}

export function numericExtraDuration(extra: Record<string, unknown>): number | undefined {
  const value = extra.duration;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

export function loadLaneRegistry(path = DEFAULT_SG_LANE_REGISTRY_PATH): RegistryLane[] {
  return loadSgLaneRegistry(path).lanes;
}

export function settleTransition(
  current: string,
  action: "release" | "reconcile" | "unreconcile",
): { kind: "noop" } | { kind: "apply"; status: ReservationStatus } | { kind: "reject"; message: string } {
  if (action === "release") {
    if (current === "RELEASED") return { kind: "noop" };
    if (current === "RESERVED") return { kind: "apply", status: "RELEASED" };
    return { kind: "reject", message: `Cannot release a ${current} reservation.` };
  }
  if (action === "reconcile") {
    if (current === "RECONCILED") return { kind: "noop" };
    if (current === "RESERVED" || current === "UNRECONCILED") {
      return { kind: "apply", status: "RECONCILED" };
    }
    return { kind: "reject", message: `Cannot reconcile a ${current} reservation.` };
  }
  if (current === "UNRECONCILED") return { kind: "noop" };
  if (current === "RESERVED") return { kind: "apply", status: "UNRECONCILED" };
  return { kind: "reject", message: `Cannot mark a ${current} reservation unreconciled.` };
}

export function requireLaneRate(laneId: string, path?: string): RegistryLane {
  const trimmed = laneId.trim();
  if (!trimmed) {
    throw new LaneRegistryError("YF_GATEWAY_LANE_ID is required for a live gateway backend.");
  }
  const lanes = loadLaneRegistry(path?.trim() || DEFAULT_SG_LANE_REGISTRY_PATH);
  const lane = lanes.find((item) => item.laneId === trimmed);
  if (!lane) {
    throw new LaneRegistryError(`Lane ${trimmed} is not in the registry. The gateway fails closed.`);
  }
  if (!(lane.usdPerSecond > 0)) {
    throw new LaneRegistryError(
      `Lane ${trimmed} has usdPerSecond ${lane.usdPerSecond}. A live backend requires usdPerSecond > 0.`,
    );
  }
  return lane;
}

/**
 * Rate lookup for a new reservation or a live gateway call.
 * A disabled lane or a TBD transport fails closed. Settlement of an
 * existing hold uses requireLaneRate, which does not apply these checks.
 */
export function requireLiveLane(laneId: string, path?: string): RegistryLane {
  const lane = requireLaneRate(laneId, path);
  if (isTbdProviderKey(lane.providerKey)) {
    throw new LaneRegistryError(
      `Lane ${lane.laneId} providerKey starts with TBD:. A live gateway fails closed until the transport is set.`,
    );
  }
  if (!lane.enabled) {
    throw new LaneRegistryError(`Lane ${lane.laneId} is disabled. A live gateway fails closed.`);
  }
  return lane;
}

/** D11 estimate plus the lane identity the app hold and gateway reservation must share. */
export type ExpectedLaneCharge = LaneChargeEstimate & {
  laneId: string;
  laneClass: string;
  providerKey: string;
  modelId: string;
  usdPerSecond: number;
};

/**
 * Single paid estimate for app holds and the live gateway.
 * Same lane id and duration always yield today's `estimateLaneCharge(requireLiveLane(...), duration)`.
 * The D11 formula (`D_bill × usdPerSecond`) is unchanged.
 */
export function expectedLaneCharge(
  laneId: string,
  requestedDurationS?: number,
  path?: string,
): ExpectedLaneCharge {
  const lane = requireLiveLane(laneId, path);
  const charge = estimateLaneCharge(lane, requestedDurationS);
  return {
    ...charge,
    laneId: lane.laneId,
    laneClass: lane.laneClass,
    providerKey: lane.providerKey,
    modelId: lane.modelId,
    usdPerSecond: lane.usdPerSecond,
  };
}

export class SharedDurationError extends Error {
  readonly code = "DURATION_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "SharedDurationError";
  }
}

/**
 * Duration shared by the app estimate and the live gateway.
 * Reads `YF_GATEWAY_BACKEND_INPUT_JSON.duration` (finite number) when `raw` is omitted.
 * No duration field → undefined, and `estimateLaneCharge` uses `lane.clipDurationS`.
 * Invalid JSON fails closed. A gateway that bills a different duration is not corrected here;
 * generate-time receipt verify refuses that job.
 */
export function sharedGatewayRequestedDurationS(raw?: string): number | undefined {
  const source = raw === undefined ? process.env.YF_GATEWAY_BACKEND_INPUT_JSON : raw;
  if (!source || source.trim() === "") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new SharedDurationError("YF_GATEWAY_BACKEND_INPUT_JSON must be a JSON object.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SharedDurationError("YF_GATEWAY_BACKEND_INPUT_JSON must be a JSON object.");
  }
  return numericExtraDuration(parsed as Record<string, unknown>);
}

/** Fields echoed on a live generate response and stored on GatewaySpendReservation. */
export type ReservationEcho = {
  laneId: string;
  modelId: string | null;
  usdPerSecond: number;
  estimatedBilledSeconds: number;
  reservedUsd: number;
};

export function reservationEchoFromCharge(charge: ExpectedLaneCharge): ReservationEcho {
  return {
    laneId: charge.laneId,
    modelId: charge.modelId,
    usdPerSecond: roundMeasure(charge.usdPerSecond),
    estimatedBilledSeconds: charge.estimatedBilledSeconds,
    reservedUsd: charge.reservedUsd,
  };
}

/** Complete echo, or null when any money/identity field is missing. Does not invent values. */
export function readReservationEcho(source: object | null | undefined): ReservationEcho | null {
  if (!source) {
    return null;
  }
  const row = source as Record<string, unknown>;
  const laneId = row.laneId;
  const modelId = row.modelId;
  const usdPerSecond = row.usdPerSecond;
  const estimatedBilledSeconds = row.estimatedBilledSeconds;
  const reservedUsd = row.reservedUsd;
  if (typeof laneId !== "string" || laneId.length === 0) {
    return null;
  }
  if (!(typeof modelId === "string" || modelId === null)) {
    return null;
  }
  if (typeof usdPerSecond !== "number" || !Number.isFinite(usdPerSecond)) {
    return null;
  }
  if (typeof estimatedBilledSeconds !== "number" || !Number.isFinite(estimatedBilledSeconds)) {
    return null;
  }
  if (typeof reservedUsd !== "number" || !Number.isFinite(reservedUsd)) {
    return null;
  }
  return { laneId, modelId, usdPerSecond, estimatedBilledSeconds, reservedUsd };
}

export type ReservationChargeSnapshot = {
  laneId: string;
  modelId: string | null;
  usdPerSecond: number;
  estimatedBilledSeconds: number;
  usd: number;
};

export type ReservationMismatchField =
  | "laneId"
  | "modelId"
  | "usdPerSecond"
  | "estimatedBilledSeconds"
  | "usd";

/** Null when the gateway reservation and the app hold are the same economic event. */
export function reservationChargeMismatch(
  hold: ReservationChargeSnapshot,
  gateway: ReservationChargeSnapshot,
): ReservationMismatchField | null {
  if (gateway.laneId !== hold.laneId) {
    return "laneId";
  }
  if ((gateway.modelId ?? null) !== (hold.modelId ?? null)) {
    return "modelId";
  }
  if (roundMeasure(gateway.usdPerSecond) !== roundMeasure(hold.usdPerSecond)) {
    return "usdPerSecond";
  }
  if (roundMeasure(gateway.estimatedBilledSeconds) !== roundMeasure(hold.estimatedBilledSeconds)) {
    return "estimatedBilledSeconds";
  }
  if (roundMeasure(gateway.usd) !== roundMeasure(hold.usd)) {
    return "usd";
  }
  return null;
}

export type HoldExpectedMismatchField = "estimatedBilledSeconds" | "usdPerSecond" | "estimatedUsd";

/** Pre-generate check. Compares the hold to a fresh expectedLaneCharge after roundMeasure. */
export function holdExpectedChargeMismatch(
  hold: { estimatedBilledSeconds: number; usdPerSecond: number; estimatedUsd: number },
  expected: { estimatedBilledSeconds: number; usdPerSecond: number; reservedUsd: number },
): HoldExpectedMismatchField | null {
  if (roundMeasure(hold.usdPerSecond) !== roundMeasure(expected.usdPerSecond)) {
    return "usdPerSecond";
  }
  if (roundMeasure(hold.estimatedBilledSeconds) !== roundMeasure(expected.estimatedBilledSeconds)) {
    return "estimatedBilledSeconds";
  }
  if (roundMeasure(hold.estimatedUsd) !== roundMeasure(expected.reservedUsd)) {
    return "estimatedUsd";
  }
  return null;
}
