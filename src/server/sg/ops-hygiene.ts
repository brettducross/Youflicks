import type { PrismaClient } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { GeneratedAssetStatus } from "@/server/domain/status";
import { isSafeFailureToken } from "@/server/sg/attempt-outcome";
import type { AiVideoBudgetPort } from "@/server/sg/ai-video-budget";
import {
  aiVideoSecondsUsageEventId,
  meterableBilledSeconds,
  recordSettledAiVideoSeconds,
  type MeteredBudgetHold,
} from "@/server/sg/metering";
import { PrismaShotFulfillment } from "@/server/sg/shot-fulfillment";

/**
 * Ops hygiene. One entrypoint runs the unreconciled sweep, the stale
 * RESERVED sweep, and the meter backfill. It never starts a paid generate.
 *
 * Age knobs are milliseconds. Unreconciled default is 24h with a 1h floor.
 * Stale RESERVED default is 2h with a 30 minute floor, above an in-flight
 * generate. Values below the floor or above one year are rejected.
 */
export const HYGIENE_BATCH_SIZE = 100;
export const RECONCILIATION_FLAG_LIMIT = 500;
export const UNRECONCILED_SWEEP_DEFAULT_MS = 24 * 60 * 60 * 1000;
export const UNRECONCILED_SWEEP_FLOOR_MS = 60 * 60 * 1000;
export const STALE_RESERVED_DEFAULT_MS = 2 * 60 * 60 * 1000;
export const STALE_RESERVED_FLOOR_MS = 30 * 60 * 1000;
export const SWEEP_AGE_MAX_MS = 366 * 24 * 60 * 60 * 1000;

const IN_FLIGHT_JOB = new Set(["PENDING", "RUNNING"]);

export class OpsHygieneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsHygieneError";
  }
}

export type SweepAges = {
  unreconciledMinAgeMs: number;
  staleReservedMinAgeMs: number;
  now?: Date;
};

export type UnreconciledListing = {
  id: string;
  ageMs: number;
  settleReason: string | null;
  laneId: string;
  estimatedUsd: number;
  gatewayStatus: string | null;
};

export type StaleReservedKept = {
  id: string;
  laneId: string;
  reason: "IN_FLIGHT" | "LINKED_ATTEMPT";
};

export type OpsHygieneReport = {
  unreconciled: {
    minAgeMs: number;
    stillUnreconciled: UnreconciledListing[];
    releasedIds: string[];
    reconciledIds: string[];
  };
  staleReserved: {
    minAgeMs: number;
    releasedIds: string[];
    kept: StaleReservedKept[];
  };
  meter: {
    inserted: number;
    alreadyPresent: number;
  };
};

export type ReconciliationFlag =
  | {
      kind: "MISMATCH";
      attemptId: string;
      budgetReservationId: string | null;
      gatewayReservationId: string;
      attemptLaneId: string;
      gatewayLaneId: string;
      attemptModelId: string | null;
      gatewayModelId: string | null;
      fields: Array<"laneId" | "modelId">;
    }
  | {
      kind: "UNRESOLVED_LINK";
      attemptId: string;
      budgetReservationId: string | null;
      gatewayReservationId: string;
      attemptLaneId: string;
      attemptModelId: string | null;
    };

type HoldRow = {
  id: string;
  projectId: string;
  userId: string;
  laneId: string;
  providerKey: string;
  idempotencyKey: string;
  estimatedBilledSeconds: number;
  estimatedUsd: number;
  actualBilledSeconds: number | null;
  actualUsd: number | null;
  status: string;
  settleReason: string | null;
  gatewayReservationId: string | null;
  createdAt: Date;
  settledAt: Date | null;
};

type AttemptLink = {
  id: string;
  outcome: string;
  failureCode: string | null;
  jobId: string | null;
  budgetReservationId: string | null;
  gatewayReservationId: string | null;
  generatedAssetId: string | null;
  laneId: string;
  modelId: string | null;
  startedAt: Date;
};

type GatewayRow = {
  id: string;
  laneId: string;
  modelId: string | null;
  status: string;
  settleReason: string | null;
  actualBilledSeconds: number | null;
  actualUsd: number | null;
};

export function parseSweepAgeMs(
  raw: string | undefined,
  fallback: number,
  floor: number,
  name: string,
): number {
  if (raw == null || raw.trim() === "") {
    return fallback;
  }
  const text = raw.trim();
  if (!/^[0-9]+$/.test(text)) {
    throw new OpsHygieneError(`${name} must be an integer number of milliseconds.`);
  }
  const value = Number(text);
  return assertSweepAge(value, floor, name);
}

export function assertSweepAge(value: number, floor: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < floor || value > SWEEP_AGE_MAX_MS) {
    throw new OpsHygieneError(
      `${name} must be an integer from ${floor} to ${SWEEP_AGE_MAX_MS} milliseconds.`,
    );
  }
  return value;
}

export function readSweepAges(source: NodeJS.ProcessEnv = process.env): SweepAges {
  return {
    unreconciledMinAgeMs: parseSweepAgeMs(
      source.SG_UNRECONCILED_SWEEP_MIN_AGE_MS,
      UNRECONCILED_SWEEP_DEFAULT_MS,
      UNRECONCILED_SWEEP_FLOOR_MS,
      "SG_UNRECONCILED_SWEEP_MIN_AGE_MS",
    ),
    staleReservedMinAgeMs: parseSweepAgeMs(
      source.SG_STALE_RESERVED_SWEEP_MIN_AGE_MS,
      STALE_RESERVED_DEFAULT_MS,
      STALE_RESERVED_FLOOR_MS,
      "SG_STALE_RESERVED_SWEEP_MIN_AGE_MS",
    ),
  };
}

/** True when a settled hold should gain an AI_VIDEO_SECONDS row. */
export function sweepShouldMeter(hold: {
  status: string;
  actualBilledSeconds: number | null;
}): boolean {
  return meterableBilledSeconds({
    id: "sweep",
    userId: "sweep",
    projectId: "sweep",
    providerKey: "sweep",
    status: hold.status,
    settleReason: null,
    actualBilledSeconds: hold.actualBilledSeconds,
  }) != null;
}

export function reconciliationFieldMismatch(
  attempt: { laneId: string; modelId: string | null },
  gateway: { laneId: string; modelId: string | null },
): Array<"laneId" | "modelId"> {
  const fields: Array<"laneId" | "modelId"> = [];
  if (attempt.laneId !== gateway.laneId) {
    fields.push("laneId");
  }
  if (attempt.modelId == null && gateway.modelId == null) {
    return fields;
  }
  if (attempt.modelId !== gateway.modelId) {
    fields.push("modelId");
  }
  return fields;
}

function isAged(anchor: Date, now: Date, minAgeMs: number): boolean {
  return now.getTime() - anchor.getTime() >= minAgeMs;
}

function finiteNonNegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function jobIdFromIdempotencyKey(key: string): string | null {
  const parts = key.split(":");
  if (parts[0] !== "asset" || !parts[1]) {
    return null;
  }
  return parts[1];
}

function timeoutRewrite(input: {
  settlement: "RECONCILED" | "RELEASED";
  priorFailureCode: string | null;
  settleReason: string | null;
  readyAsset: boolean;
}): { outcome: "FAILED" | "SUCCEEDED"; failureCode: string | null } {
  if (input.settlement === "RECONCILED" && input.readyAsset) {
    return { outcome: "SUCCEEDED", failureCode: null };
  }
  if (input.settlement === "RELEASED") {
    const prior = isSafeFailureToken(input.priorFailureCode) ? input.priorFailureCode : null;
    return { outcome: "FAILED", failureCode: prior ? `RELEASED:${prior}` : "RELEASED" };
  }
  const reason = isSafeFailureToken(input.settleReason) ? input.settleReason : "RECONCILED";
  return { outcome: "FAILED", failureCode: reason };
}

export async function runOpsHygiene(
  db: PrismaClient,
  budgets: AiVideoBudgetPort,
  ages: SweepAges,
): Promise<OpsHygieneReport> {
  const unreconciledMinAgeMs = assertSweepAge(
    ages.unreconciledMinAgeMs,
    UNRECONCILED_SWEEP_FLOOR_MS,
    "SG_UNRECONCILED_SWEEP_MIN_AGE_MS",
  );
  const staleReservedMinAgeMs = assertSweepAge(
    ages.staleReservedMinAgeMs,
    STALE_RESERVED_FLOOR_MS,
    "SG_STALE_RESERVED_SWEEP_MIN_AGE_MS",
  );
  const now = ages.now ?? new Date();
  const unreconciled = await sweepUnreconciled(db, budgets, unreconciledMinAgeMs, now);
  const staleReserved = await sweepStaleReserved(db, budgets, staleReservedMinAgeMs, now);
  const meter = await backfillMissingMeters(db);
  const report: OpsHygieneReport = { unreconciled, staleReserved, meter };
  logger.info("sg.ops_hygiene", {
    stillUnreconciled: unreconciled.stillUnreconciled.length,
    released: unreconciled.releasedIds.length,
    reconciled: unreconciled.reconciledIds.length,
    staleReleased: staleReserved.releasedIds.length,
    meterInserted: meter.inserted,
  });
  return report;
}

async function sweepUnreconciled(
  db: PrismaClient,
  budgets: AiVideoBudgetPort,
  minAgeMs: number,
  now: Date,
): Promise<OpsHygieneReport["unreconciled"]> {
  const cutoff = new Date(now.getTime() - minAgeMs);
  const holds = await db.aiVideoBudgetReservation.findMany({
    where: {
      status: "UNRECONCILED",
      OR: [
        { settledAt: { lte: cutoff } },
        { AND: [{ settledAt: null }, { createdAt: { lte: cutoff } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: HYGIENE_BATCH_SIZE,
  });
  const attempts = await attemptsForHolds(db, holds.map((hold) => hold.id));
  const gatewayIds = new Set<string>();
  for (const hold of holds) {
    const linked = gatewayIdFor(hold, attempts.get(hold.id) ?? []);
    if (linked) gatewayIds.add(linked);
  }
  const gateways = await loadGateways(db, [...gatewayIds]);
  const fulfillments = new PrismaShotFulfillment(db);
  const stillUnreconciled: UnreconciledListing[] = [];
  const releasedIds: string[] = [];
  const reconciledIds: string[] = [];

  for (const hold of holds) {
    const anchor = hold.settledAt ?? hold.createdAt;
    if (!isAged(anchor, now, minAgeMs)) {
      continue;
    }
    const linkedAttempts = attempts.get(hold.id) ?? [];
    const gatewayId = gatewayIdFor(hold, linkedAttempts);
    const gateway = gatewayId ? gateways.get(gatewayId) ?? null : null;
    const ageMs = now.getTime() - anchor.getTime();
    if (gateway?.status === "RELEASED") {
      const reason =
        gateway.settleReason === "CAP_DENIED"
          ? "CAP_DENIED"
          : isSafeFailureToken(gateway.settleReason)
            ? gateway.settleReason
            : "GATEWAY_RELEASED";
      const settled = await budgets.release(hold.id, reason);
      releasedIds.push(hold.id);
      await rewriteTimeoutAttempts(db, fulfillments, linkedAttempts, "RELEASED", settled);
      continue;
    }
    if (gateway?.status === "RECONCILED" && finiteNonNegative(gateway.actualBilledSeconds)) {
      const reason = isSafeFailureToken(gateway.settleReason) ? gateway.settleReason : "GATEWAY_RECONCILED";
      const settled = await budgets.reconcile(hold.id, {
        actualBilledSeconds: gateway.actualBilledSeconds,
        reason,
      });
      reconciledIds.push(hold.id);
      await rewriteTimeoutAttempts(db, fulfillments, linkedAttempts, "RECONCILED", settled);
      continue;
    }
    stillUnreconciled.push({
      id: hold.id,
      ageMs,
      settleReason: hold.settleReason,
      laneId: hold.laneId,
      estimatedUsd: hold.estimatedUsd,
      gatewayStatus: gateway?.status ?? null,
    });
  }

  return { minAgeMs, stillUnreconciled, releasedIds, reconciledIds };
}

async function rewriteTimeoutAttempts(
  db: PrismaClient,
  fulfillments: PrismaShotFulfillment,
  attempts: readonly AttemptLink[],
  settlement: "RECONCILED" | "RELEASED",
  hold: {
    settleReason: string | null;
    actualBilledSeconds: number | null;
    actualUsd: number | null;
  },
) {
  for (const attempt of attempts) {
    if (attempt.outcome !== "TIMEOUT_UNRECONCILED") {
      continue;
    }
    const readyAsset = await hasReadyAsset(db, attempt.generatedAssetId);
    const rewritten = timeoutRewrite({
      settlement,
      priorFailureCode: attempt.failureCode,
      settleReason: hold.settleReason,
      readyAsset,
    });
    await fulfillments.rewriteSettledTimeoutAttempt({
      attemptId: attempt.id,
      outcome: rewritten.outcome,
      failureCode: rewritten.failureCode,
      actualBilledSeconds: settlement === "RECONCILED" ? hold.actualBilledSeconds : null,
      actualUsd: settlement === "RECONCILED" ? hold.actualUsd : null,
    });
  }
}

async function hasReadyAsset(db: PrismaClient, generatedAssetId: string | null): Promise<boolean> {
  if (!generatedAssetId) {
    return false;
  }
  const asset = await db.generatedAsset.findFirst({
    where: { id: generatedAssetId, status: GeneratedAssetStatus.READY },
    select: { id: true },
  });
  return asset != null;
}

async function sweepStaleReserved(
  db: PrismaClient,
  budgets: AiVideoBudgetPort,
  minAgeMs: number,
  now: Date,
): Promise<OpsHygieneReport["staleReserved"]> {
  const cutoff = new Date(now.getTime() - minAgeMs);
  const holds = await db.aiVideoBudgetReservation.findMany({
    where: { status: "RESERVED", createdAt: { lte: cutoff } },
    orderBy: { createdAt: "asc" },
    take: HYGIENE_BATCH_SIZE,
  });
  const attempts = await attemptsForHolds(db, holds.map((hold) => hold.id));
  const jobIds = new Set<string>();
  for (const hold of holds) {
    const parsed = jobIdFromIdempotencyKey(hold.idempotencyKey);
    if (parsed) jobIds.add(parsed);
    for (const attempt of attempts.get(hold.id) ?? []) {
      if (attempt.jobId) jobIds.add(attempt.jobId);
    }
  }
  const jobs =
    jobIds.size === 0
      ? []
      : await db.job.findMany({
          where: { id: { in: [...jobIds] } },
          select: { id: true, status: true },
        });
  const jobStatus = new Map(jobs.map((job) => [job.id, job.status]));
  const releasedIds: string[] = [];
  const kept: StaleReservedKept[] = [];

  for (const hold of holds) {
    if (!isAged(hold.createdAt, now, minAgeMs)) {
      continue;
    }
    const linked = attempts.get(hold.id) ?? [];
    const running = linkedJobInFlight(hold, linked, jobStatus);
    if (running || linked.some((attempt) => attempt.outcome === "PENDING")) {
      kept.push({ id: hold.id, laneId: hold.laneId, reason: "IN_FLIGHT" });
      continue;
    }
    if (linked.length > 0) {
      kept.push({ id: hold.id, laneId: hold.laneId, reason: "LINKED_ATTEMPT" });
      continue;
    }
    await budgets.release(hold.id, "STALE_RESERVED");
    releasedIds.push(hold.id);
  }

  return { minAgeMs, releasedIds, kept };
}

function linkedJobInFlight(
  hold: { idempotencyKey: string },
  attempts: readonly AttemptLink[],
  jobStatus: ReadonlyMap<string, string>,
): boolean {
  const ids = new Set<string>();
  const parsed = jobIdFromIdempotencyKey(hold.idempotencyKey);
  if (parsed) ids.add(parsed);
  for (const attempt of attempts) {
    if (attempt.jobId) ids.add(attempt.jobId);
  }
  for (const id of ids) {
    const status = jobStatus.get(id);
    if (status && IN_FLIGHT_JOB.has(status)) {
      return true;
    }
  }
  return false;
}

async function backfillMissingMeters(db: PrismaClient): Promise<OpsHygieneReport["meter"]> {
  const holds = await db.aiVideoBudgetReservation.findMany({
    where: { status: "RECONCILED", actualBilledSeconds: { gt: 0 } },
    orderBy: { settledAt: "asc" },
    take: HYGIENE_BATCH_SIZE,
  });
  const meterable = holds.filter((hold) => sweepShouldMeter(hold));
  const ids = meterable.map((hold) => aiVideoSecondsUsageEventId(hold.id));
  const existing =
    ids.length === 0
      ? []
      : await db.usageEvent.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
  const have = new Set(existing.map((row) => row.id));
  let inserted = 0;
  for (const hold of meterable) {
    const id = aiVideoSecondsUsageEventId(hold.id);
    if (have.has(id)) {
      continue;
    }
    await recordSettledAiVideoSeconds(toMeterHold(hold), db);
    const wrote = await db.usageEvent.findUnique({ where: { id }, select: { id: true } });
    if (wrote) {
      inserted += 1;
    }
  }
  return { inserted, alreadyPresent: have.size };
}

function toMeterHold(hold: HoldRow): MeteredBudgetHold {
  return {
    id: hold.id,
    userId: hold.userId,
    projectId: hold.projectId,
    providerKey: hold.providerKey,
    status: hold.status,
    settleReason: hold.settleReason,
    actualBilledSeconds: hold.actualBilledSeconds,
  };
}

async function attemptsForHolds(db: PrismaClient, holdIds: string[]): Promise<Map<string, AttemptLink[]>> {
  const grouped = new Map<string, AttemptLink[]>();
  if (holdIds.length === 0) {
    return grouped;
  }
  const rows = await db.shotFulfillmentAttempt.findMany({
    where: { budgetReservationId: { in: holdIds } },
    select: {
      id: true,
      outcome: true,
      failureCode: true,
      jobId: true,
      budgetReservationId: true,
      gatewayReservationId: true,
      generatedAssetId: true,
      laneId: true,
      modelId: true,
      startedAt: true,
    },
  });
  for (const row of rows) {
    if (!row.budgetReservationId) {
      continue;
    }
    const list = grouped.get(row.budgetReservationId) ?? [];
    list.push(row);
    grouped.set(row.budgetReservationId, list);
  }
  return grouped;
}

function gatewayIdFor(hold: { gatewayReservationId: string | null }, attempts: readonly AttemptLink[]): string | null {
  if (hold.gatewayReservationId) {
    return hold.gatewayReservationId;
  }
  for (const attempt of attempts) {
    if (attempt.gatewayReservationId) {
      return attempt.gatewayReservationId;
    }
  }
  return null;
}

async function loadGateways(db: PrismaClient, ids: string[]): Promise<Map<string, GatewayRow>> {
  const map = new Map<string, GatewayRow>();
  if (ids.length === 0) {
    return map;
  }
  const rows = await db.gatewaySpendReservation.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      laneId: true,
      modelId: true,
      status: true,
      settleReason: true,
      actualBilledSeconds: true,
      actualUsd: true,
    },
  });
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

/**
 * Q5: gateway reservation laneId/modelId versus the attempt.
 * A missing gateway row is an unresolved link, not a match.
 * Does not rewrite lane attribution or money.
 */
export async function readReconciliationFlags(db: PrismaClient): Promise<ReconciliationFlag[]> {
  const direct = await db.shotFulfillmentAttempt.findMany({
    where: { gatewayReservationId: { not: null } },
    orderBy: { startedAt: "desc" },
    take: RECONCILIATION_FLAG_LIMIT,
    select: {
      id: true,
      laneId: true,
      modelId: true,
      gatewayReservationId: true,
      budgetReservationId: true,
      startedAt: true,
    },
  });
  const holds = await db.aiVideoBudgetReservation.findMany({
    where: { gatewayReservationId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: RECONCILIATION_FLAG_LIMIT,
    select: { id: true, gatewayReservationId: true },
  });
  const holdGateway = new Map(holds.map((hold) => [hold.id, hold.gatewayReservationId]));
  const viaHold =
    holds.length === 0
      ? []
      : await db.shotFulfillmentAttempt.findMany({
          where: {
            budgetReservationId: { in: holds.map((hold) => hold.id) },
            gatewayReservationId: null,
          },
          orderBy: { startedAt: "desc" },
          take: RECONCILIATION_FLAG_LIMIT,
          select: {
            id: true,
            laneId: true,
            modelId: true,
            gatewayReservationId: true,
            budgetReservationId: true,
            startedAt: true,
          },
        });

  type Candidate = {
    id: string;
    laneId: string;
    modelId: string | null;
    budgetReservationId: string | null;
    gatewayReservationId: string;
  };
  const candidates = new Map<string, Candidate>();
  for (const attempt of direct) {
    if (!attempt.gatewayReservationId) continue;
    candidates.set(attempt.id, {
      id: attempt.id,
      laneId: attempt.laneId,
      modelId: attempt.modelId,
      budgetReservationId: attempt.budgetReservationId,
      gatewayReservationId: attempt.gatewayReservationId,
    });
  }
  for (const attempt of viaHold) {
    if (candidates.has(attempt.id) || !attempt.budgetReservationId) continue;
    const gatewayReservationId = holdGateway.get(attempt.budgetReservationId);
    if (!gatewayReservationId) continue;
    candidates.set(attempt.id, {
      id: attempt.id,
      laneId: attempt.laneId,
      modelId: attempt.modelId,
      budgetReservationId: attempt.budgetReservationId,
      gatewayReservationId,
    });
  }

  const gateways = await loadGateways(db, [...new Set([...candidates.values()].map((row) => row.gatewayReservationId))]);
  const flags: ReconciliationFlag[] = [];
  for (const attempt of candidates.values()) {
    const gateway = gateways.get(attempt.gatewayReservationId);
    if (!gateway) {
      const flag: ReconciliationFlag = {
        kind: "UNRESOLVED_LINK",
        attemptId: attempt.id,
        budgetReservationId: attempt.budgetReservationId,
        gatewayReservationId: attempt.gatewayReservationId,
        attemptLaneId: attempt.laneId,
        attemptModelId: attempt.modelId,
      };
      flags.push(flag);
      logger.info("sg.reconciliation_flag", flag);
      continue;
    }
    const fields = reconciliationFieldMismatch(
      { laneId: attempt.laneId, modelId: attempt.modelId },
      { laneId: gateway.laneId, modelId: gateway.modelId },
    );
    if (fields.length === 0) {
      continue;
    }
    const flag: ReconciliationFlag = {
      kind: "MISMATCH",
      attemptId: attempt.id,
      budgetReservationId: attempt.budgetReservationId,
      gatewayReservationId: attempt.gatewayReservationId,
      attemptLaneId: attempt.laneId,
      gatewayLaneId: gateway.laneId,
      attemptModelId: attempt.modelId,
      gatewayModelId: gateway.modelId,
      fields,
    };
    flags.push(flag);
    logger.info("sg.reconciliation_flag", flag);
  }
  return flags;
}
