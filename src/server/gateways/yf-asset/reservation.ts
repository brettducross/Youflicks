import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { GatewaySpendCapError } from "@/server/gateways/yf-asset/ledger";
import { scopeKindForLedgerId, roundMeasure, settleTransition } from "@/server/sg/lane-rate";

export type GatewayLedgerSnapshot = {
  id: string;
  jobsAccepted: number;
  spendUsd: number;
  reservedUsd: number;
  billedSeconds: number;
  reservedSeconds: number;
  scopeKind: string;
};

export type GatewayReservationRecord = {
  id: string;
  ledgerIds: string[];
  laneId: string;
  providerKey: string;
  capability: string;
  modelId: string | null;
  idempotencyKey: string;
  gatewayJobId: string | null;
  requestedDurationS: number;
  estimatedBilledSeconds: number;
  usdPerSecond: number;
  reservedUsd: number;
  actualBilledSeconds: number | null;
  actualUsd: number | null;
  status: string;
  settleReason: string | null;
  createdAt: Date;
  settledAt: Date | null;
};

export type GatewayReserveInput = {
  idempotencyKey: string;
  ledgerIds: string[];
  laneId: string;
  providerKey: string;
  capability: string;
  modelId?: string | null;
  gatewayJobId?: string | null;
  requestedDurationS: number;
  estimatedBilledSeconds: number;
  usdPerSecond: number;
  reservedUsd: number;
  /** Job, dollar, and billed-second caps apply to this row (YF_GATEWAY_LEDGER_ID). */
  primaryLedgerId: string;
  maxJobs?: number;
  maxSpendUsd?: number;
  maxBilledSeconds?: number;
  /** Optional dollar cap on the lane row only. */
  laneLedgerId?: string;
  laneMaxSpendUsd?: number;
};

export type GatewayReconcileInput = {
  actualBilledSeconds: number;
  reason: string;
};

type SettleAction = "release" | "reconcile" | "unreconcile";

type LedgerRow = GatewayLedgerSnapshot;

export class ReservationStateError extends Error {
  readonly code = "RESERVATION_STATE";

  constructor(message: string) {
    super(message);
    this.name = "ReservationStateError";
  }
}

export interface GatewayReservationPort {
  reserve(input: GatewayReserveInput): Promise<GatewayReservationRecord>;
  bindGatewayJob(id: string, gatewayJobId: string): Promise<GatewayReservationRecord>;
  release(id: string, reason: string): Promise<GatewayReservationRecord>;
  reconcile(id: string, input: GatewayReconcileInput): Promise<GatewayReservationRecord>;
  markUnreconciled(id: string, reason: string): Promise<GatewayReservationRecord>;
  get(id: string): Promise<GatewayReservationRecord | null>;
  snapshot(ledgerId: string): Promise<GatewayLedgerSnapshot>;
}

function assertPrimaryCaps(row: LedgerRow, input: GatewayReserveInput) {
  if (input.maxJobs !== undefined && row.jobsAccepted >= input.maxJobs) {
    throw new GatewaySpendCapError(
      `Gateway job cap reached (${input.maxJobs}). Raise YF_GATEWAY_MAX_JOBS or wait.`,
    );
  }
  if (input.maxSpendUsd !== undefined && row.spendUsd + input.reservedUsd > input.maxSpendUsd) {
    throw new GatewaySpendCapError(
      `Gateway spend cap reached ($${input.maxSpendUsd}). Raise YF_GATEWAY_MAX_SPEND_USD or wait.`,
    );
  }
  if (
    input.maxBilledSeconds !== undefined &&
    row.billedSeconds + input.estimatedBilledSeconds > input.maxBilledSeconds
  ) {
    throw new GatewaySpendCapError(
      `Gateway billed-seconds cap reached (${input.maxBilledSeconds}s). Raise YF_GATEWAY_MAX_BILLED_SECONDS or wait.`,
    );
  }
}

function assertLaneCap(row: LedgerRow, input: GatewayReserveInput) {
  if (
    input.laneLedgerId &&
    row.id === input.laneLedgerId &&
    input.laneMaxSpendUsd !== undefined &&
    row.spendUsd + input.reservedUsd > input.laneMaxSpendUsd
  ) {
    throw new GatewaySpendCapError(
      `Lane spend cap reached ($${input.laneMaxSpendUsd}). Raise YF_GATEWAY_LANE_MAX_SPEND_USD or wait.`,
    );
  }
}

function applyReserve(row: LedgerRow, input: GatewayReserveInput): LedgerRow {
  return {
    ...row,
    jobsAccepted: row.jobsAccepted + 1,
    spendUsd: roundMeasure(row.spendUsd + input.reservedUsd),
    reservedUsd: roundMeasure(row.reservedUsd + input.reservedUsd),
    billedSeconds: roundMeasure(row.billedSeconds + input.estimatedBilledSeconds),
    reservedSeconds: roundMeasure(row.reservedSeconds + input.estimatedBilledSeconds),
  };
}

function applyRelease(row: LedgerRow, reservation: GatewayReservationRecord): LedgerRow {
  return {
    ...row,
    spendUsd: roundMeasure(row.spendUsd - reservation.reservedUsd),
    reservedUsd: roundMeasure(row.reservedUsd - reservation.reservedUsd),
    billedSeconds: roundMeasure(row.billedSeconds - reservation.estimatedBilledSeconds),
    reservedSeconds: roundMeasure(row.reservedSeconds - reservation.estimatedBilledSeconds),
  };
}

function applyReconcile(
  row: LedgerRow,
  reservation: GatewayReservationRecord,
  actualBilledSeconds: number,
): LedgerRow {
  const actualUsd = roundMeasure(actualBilledSeconds * reservation.usdPerSecond);
  return {
    ...row,
    spendUsd: roundMeasure(row.spendUsd + (actualUsd - reservation.reservedUsd)),
    reservedUsd: roundMeasure(row.reservedUsd - reservation.reservedUsd),
    billedSeconds: roundMeasure(
      row.billedSeconds + (actualBilledSeconds - reservation.estimatedBilledSeconds),
    ),
    reservedSeconds: roundMeasure(row.reservedSeconds - reservation.estimatedBilledSeconds),
  };
}

function emptyLedger(id: string): LedgerRow {
  return {
    id,
    jobsAccepted: 0,
    spendUsd: 0,
    reservedUsd: 0,
    billedSeconds: 0,
    reservedSeconds: 0,
    scopeKind: scopeKindForLedgerId(id),
  };
}

function sortedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

export class MemoryGatewayReservation implements GatewayReservationPort {
  private readonly ledgers = new Map<string, LedgerRow>();
  private readonly reservations = new Map<string, GatewayReservationRecord>();
  private readonly byKey = new Map<string, string>();
  private chain: Promise<unknown> = Promise.resolve();

  async reserve(input: GatewayReserveInput): Promise<GatewayReservationRecord> {
    return this.exclusive(() => this.reserveUnlocked(input));
  }

  async bindGatewayJob(id: string, gatewayJobId: string): Promise<GatewayReservationRecord> {
    return this.exclusive(() => {
      const row = this.must(id);
      row.gatewayJobId = gatewayJobId;
      return Promise.resolve({ ...row });
    });
  }

  async release(id: string, reason: string): Promise<GatewayReservationRecord> {
    return this.exclusive(() => this.settleUnlocked(id, "release", reason));
  }

  async reconcile(id: string, input: GatewayReconcileInput): Promise<GatewayReservationRecord> {
    return this.exclusive(() => this.settleUnlocked(id, "reconcile", input.reason, input.actualBilledSeconds));
  }

  async markUnreconciled(id: string, reason: string): Promise<GatewayReservationRecord> {
    return this.exclusive(() => this.settleUnlocked(id, "unreconcile", reason));
  }

  async get(id: string): Promise<GatewayReservationRecord | null> {
    const row = this.reservations.get(id);
    return row ? { ...row, ledgerIds: [...row.ledgerIds] } : null;
  }

  async snapshot(ledgerId: string): Promise<GatewayLedgerSnapshot> {
    return { ...(this.ledgers.get(ledgerId) ?? emptyLedger(ledgerId)) };
  }

  private reserveUnlocked(input: GatewayReserveInput): GatewayReservationRecord {
    const ledgerIds = sortedIds(input.ledgerIds);
    const existingId = this.byKey.get(input.idempotencyKey);
    if (existingId) {
      return this.copy(this.must(existingId));
    }
    const rows = ledgerIds.map((id) => this.ledgers.get(id) ?? emptyLedger(id));
    for (const row of rows) {
      if (row.id === input.primaryLedgerId) {
        assertPrimaryCaps(row, input);
      }
      assertLaneCap(row, input);
    }
    const now = new Date();
    const created: GatewayReservationRecord = {
      id: randomUUID(),
      ledgerIds,
      laneId: input.laneId,
      providerKey: input.providerKey,
      capability: input.capability,
      modelId: input.modelId ?? null,
      idempotencyKey: input.idempotencyKey,
      gatewayJobId: input.gatewayJobId ?? null,
      requestedDurationS: input.requestedDurationS,
      estimatedBilledSeconds: input.estimatedBilledSeconds,
      usdPerSecond: input.usdPerSecond,
      reservedUsd: input.reservedUsd,
      actualBilledSeconds: null,
      actualUsd: null,
      status: "RESERVED",
      settleReason: null,
      createdAt: now,
      settledAt: null,
    };
    for (const row of rows) {
      this.ledgers.set(row.id, applyReserve(row, input));
    }
    this.reservations.set(created.id, created);
    this.byKey.set(created.idempotencyKey, created.id);
    return this.copy(created);
  }

  private settleUnlocked(
    id: string,
    action: SettleAction,
    reason: string,
    actualBilledSeconds?: number,
  ): GatewayReservationRecord {
    const row = this.must(id);
    const transition = settleTransition(row.status, action);
    if (transition.kind === "reject") {
      throw new ReservationStateError(transition.message);
    }
    if (transition.kind === "noop") {
      return this.copy(row);
    }
    if (action === "release") {
      for (const ledgerId of row.ledgerIds) {
        const ledger = this.ledgers.get(ledgerId) ?? emptyLedger(ledgerId);
        this.ledgers.set(ledgerId, applyRelease(ledger, row));
      }
    } else if (action === "reconcile") {
      const actual = actualBilledSeconds ?? row.estimatedBilledSeconds;
      for (const ledgerId of row.ledgerIds) {
        const ledger = this.ledgers.get(ledgerId) ?? emptyLedger(ledgerId);
        this.ledgers.set(ledgerId, applyReconcile(ledger, row, actual));
      }
      row.actualBilledSeconds = actual;
      row.actualUsd = roundMeasure(actual * row.usdPerSecond);
    }
    row.status = transition.status;
    row.settleReason = reason;
    row.settledAt = new Date();
    return this.copy(row);
  }

  private must(id: string): GatewayReservationRecord {
    const row = this.reservations.get(id);
    if (!row) {
      throw new ReservationStateError(`Reservation ${id} was not found.`);
    }
    return row;
  }

  private copy(row: GatewayReservationRecord): GatewayReservationRecord {
    return { ...row, ledgerIds: [...row.ledgerIds] };
  }

  private exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

type ReservationDb = Pick<
  PrismaClient,
  "gatewaySpendLedger" | "gatewaySpendReservation" | "$transaction"
>;

export class PrismaGatewayReservation implements GatewayReservationPort {
  constructor(private readonly db: ReservationDb) {}

  async reserve(input: GatewayReserveInput): Promise<GatewayReservationRecord> {
    const ledgerIds = sortedIds(input.ledgerIds);
    const created = await this.db.$transaction(async (tx) => {
      for (const id of ledgerIds) {
        await tx.$executeRaw`
          INSERT INTO gateway_spend_ledger (
            id, "jobsAccepted", "spendUsd", "reservedUsd", "billedSeconds", "reservedSeconds",
            "scopeKind", "updatedAt", "createdAt"
          )
          VALUES (
            ${id}, 0, 0, 0, 0, 0, ${scopeKindForLedgerId(id)}, NOW(), NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `;
        await tx.$queryRaw`
          SELECT id FROM gateway_spend_ledger WHERE id = ${id} FOR UPDATE
        `;
      }
      const existing = await tx.gatewaySpendReservation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return existing;
      }
      const locked = await tx.gatewaySpendLedger.findMany({ where: { id: { in: ledgerIds } } });
      const byId = new Map(locked.map((row) => [row.id, toSnapshot(row)]));
      for (const id of ledgerIds) {
        const row = byId.get(id) ?? emptyLedger(id);
        if (row.id === input.primaryLedgerId) {
          assertPrimaryCaps(row, input);
        }
        assertLaneCap(row, input);
      }
      const reservation = await tx.gatewaySpendReservation.create({
        data: {
          ledgerIds,
          laneId: input.laneId,
          providerKey: input.providerKey,
          capability: input.capability,
          modelId: input.modelId ?? null,
          idempotencyKey: input.idempotencyKey,
          gatewayJobId: input.gatewayJobId ?? null,
          requestedDurationS: input.requestedDurationS,
          estimatedBilledSeconds: input.estimatedBilledSeconds,
          usdPerSecond: input.usdPerSecond,
          reservedUsd: input.reservedUsd,
          status: "RESERVED",
        },
      });
      for (const id of ledgerIds) {
        const row = byId.get(id) ?? emptyLedger(id);
        const next = applyReserve(row, input);
        await tx.gatewaySpendLedger.update({
          where: { id },
          data: {
            jobsAccepted: next.jobsAccepted,
            spendUsd: next.spendUsd,
            reservedUsd: next.reservedUsd,
            billedSeconds: next.billedSeconds,
            reservedSeconds: next.reservedSeconds,
            scopeKind: row.scopeKind || scopeKindForLedgerId(id),
          },
        });
      }
      return reservation;
    });
    return toReservation(created);
  }

  async bindGatewayJob(id: string, gatewayJobId: string): Promise<GatewayReservationRecord> {
    const row = await this.db.gatewaySpendReservation.update({
      where: { id },
      data: { gatewayJobId },
    });
    return toReservation(row);
  }

  async release(id: string, reason: string): Promise<GatewayReservationRecord> {
    return this.settle(id, "release", reason);
  }

  async reconcile(id: string, input: GatewayReconcileInput): Promise<GatewayReservationRecord> {
    return this.settle(id, "reconcile", input.reason, input.actualBilledSeconds);
  }

  async markUnreconciled(id: string, reason: string): Promise<GatewayReservationRecord> {
    return this.settle(id, "unreconcile", reason);
  }

  async get(id: string): Promise<GatewayReservationRecord | null> {
    const row = await this.db.gatewaySpendReservation.findUnique({ where: { id } });
    return row ? toReservation(row) : null;
  }

  async snapshot(ledgerId: string): Promise<GatewayLedgerSnapshot> {
    const row = await this.db.gatewaySpendLedger.findUnique({ where: { id: ledgerId } });
    return row ? toSnapshot(row) : emptyLedger(ledgerId);
  }

  private async settle(
    id: string,
    action: SettleAction,
    reason: string,
    actualBilledSeconds?: number,
  ): Promise<GatewayReservationRecord> {
    const updated = await this.db.$transaction(async (tx) => {
      const lockedReservation = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM gateway_spend_reservation WHERE id = ${id} FOR UPDATE
      `;
      if (!lockedReservation[0]) {
        throw new ReservationStateError(`Reservation ${id} was not found.`);
      }
      const current = await tx.gatewaySpendReservation.findUniqueOrThrow({ where: { id } });
      const ledgerIds = sortedIds(current.ledgerIds);
      for (const ledgerId of ledgerIds) {
        await tx.$queryRaw`
          SELECT id FROM gateway_spend_ledger WHERE id = ${ledgerId} FOR UPDATE
        `;
      }
      const transition = settleTransition(current.status, action);
      if (transition.kind === "reject") {
        throw new ReservationStateError(transition.message);
      }
      if (transition.kind === "noop") {
        return current;
      }
      const reservation = toReservation(current);
      if (action === "release") {
        for (const ledgerId of ledgerIds) {
          const ledger = await tx.gatewaySpendLedger.findUniqueOrThrow({ where: { id: ledgerId } });
          const next = applyRelease(toSnapshot(ledger), reservation);
          await tx.gatewaySpendLedger.update({
            where: { id: ledgerId },
            data: {
              spendUsd: next.spendUsd,
              reservedUsd: next.reservedUsd,
              billedSeconds: next.billedSeconds,
              reservedSeconds: next.reservedSeconds,
            },
          });
        }
      } else if (action === "reconcile") {
        const actual = actualBilledSeconds ?? reservation.estimatedBilledSeconds;
        for (const ledgerId of ledgerIds) {
          const ledger = await tx.gatewaySpendLedger.findUniqueOrThrow({ where: { id: ledgerId } });
          const next = applyReconcile(toSnapshot(ledger), reservation, actual);
          await tx.gatewaySpendLedger.update({
            where: { id: ledgerId },
            data: {
              spendUsd: next.spendUsd,
              reservedUsd: next.reservedUsd,
              billedSeconds: next.billedSeconds,
              reservedSeconds: next.reservedSeconds,
            },
          });
        }
        return tx.gatewaySpendReservation.update({
          where: { id },
          data: {
            status: transition.status,
            settleReason: reason,
            settledAt: new Date(),
            actualBilledSeconds: actual,
            actualUsd: roundMeasure(actual * reservation.usdPerSecond),
          },
        });
      }
      return tx.gatewaySpendReservation.update({
        where: { id },
        data: {
          status: transition.status,
          settleReason: reason,
          settledAt: new Date(),
        },
      });
    });
    return toReservation(updated);
  }
}

function toSnapshot(row: {
  id: string;
  jobsAccepted: number;
  spendUsd: number;
  reservedUsd: number;
  billedSeconds: number;
  reservedSeconds: number;
  scopeKind: string;
}): GatewayLedgerSnapshot {
  return {
    id: row.id,
    jobsAccepted: row.jobsAccepted,
    spendUsd: row.spendUsd,
    reservedUsd: row.reservedUsd,
    billedSeconds: row.billedSeconds,
    reservedSeconds: row.reservedSeconds,
    scopeKind: row.scopeKind,
  };
}

function toReservation(row: {
  id: string;
  ledgerIds: string[];
  laneId: string;
  providerKey: string;
  capability: string;
  modelId: string | null;
  idempotencyKey: string;
  gatewayJobId: string | null;
  requestedDurationS: number;
  estimatedBilledSeconds: number;
  usdPerSecond: number;
  reservedUsd: number;
  actualBilledSeconds: number | null;
  actualUsd: number | null;
  status: string;
  settleReason: string | null;
  createdAt: Date;
  settledAt: Date | null;
}): GatewayReservationRecord {
  return {
    id: row.id,
    ledgerIds: [...row.ledgerIds],
    laneId: row.laneId,
    providerKey: row.providerKey,
    capability: row.capability,
    modelId: row.modelId,
    idempotencyKey: row.idempotencyKey,
    gatewayJobId: row.gatewayJobId,
    requestedDurationS: row.requestedDurationS,
    estimatedBilledSeconds: row.estimatedBilledSeconds,
    usdPerSecond: row.usdPerSecond,
    reservedUsd: row.reservedUsd,
    actualBilledSeconds: row.actualBilledSeconds,
    actualUsd: row.actualUsd,
    status: row.status,
    settleReason: row.settleReason,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
  };
}
