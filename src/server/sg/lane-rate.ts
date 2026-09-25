import {
  DEFAULT_SG_LANE_REGISTRY_PATH,
  LaneRegistryError,
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
