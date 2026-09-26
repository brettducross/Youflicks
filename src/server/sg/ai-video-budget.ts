import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  projectBudgetLedgerId,
  userWindowBudgetLedgerId,
  type AiVideoBudgetCaps,
} from "@/server/sg/budget-source";
import { roundMeasure, settleTransition, type ReservationStatus } from "@/server/sg/lane-rate";
import { recordSettledAiVideoSeconds } from "@/server/sg/metering";

export class AiVideoBudgetCapError extends Error {
  readonly code = "AI_VIDEO_BUDGET_CAP";

  constructor(message: string) {
    super(message);
    this.name = "AiVideoBudgetCapError";
  }
}

export type AiVideoBudgetLedgerSnapshot = {
  id: string;
  scopeKind: string;
  projectId: string | null;
  userId: string | null;
  windowKey: string | null;
  reservedSeconds: number;
  committedSeconds: number;
  reservedUsd: number;
  committedUsd: number;
  attempts: number;
};

export type AiVideoBudgetReservationRecord = {
  id: string;
  projectId: string;
  userId: string;
  ledgerIds: string[];
  laneId: string;
  providerKey: string;
  idempotencyKey: string;
  estimatedBilledSeconds: number;
  usdPerSecond: number;
  estimatedUsd: number;
  actualBilledSeconds: number | null;
  actualUsd: number | null;
  status: string;
  settleReason: string | null;
  gatewayReservationId: string | null;
  createdAt: Date;
  settledAt: Date | null;
};

export type AiVideoBudgetReserveInput = {
  idempotencyKey: string;
  projectId: string;
  userId: string;
  windowKey: string;
  laneId: string;
  providerKey: string;
  estimatedBilledSeconds: number;
  usdPerSecond: number;
  estimatedUsd: number;
  caps: AiVideoBudgetCaps;
  gatewayReservationId?: string | null;
};

type BudgetLedgerRow = AiVideoBudgetLedgerSnapshot;

export interface AiVideoBudgetPort {
  reserve(input: AiVideoBudgetReserveInput): Promise<AiVideoBudgetReservationRecord>;
  release(id: string, reason: string): Promise<AiVideoBudgetReservationRecord>;
  reconcile(
    id: string,
    input: { actualBilledSeconds: number; reason: string },
  ): Promise<AiVideoBudgetReservationRecord>;
  markUnreconciled(id: string, reason: string): Promise<AiVideoBudgetReservationRecord>;
  /** Fills gatewayReservationId when it is still null. Does not change settlement. */
  rememberGatewayReservationId(
    id: string,
    gatewayReservationId: string,
  ): Promise<AiVideoBudgetReservationRecord>;
  snapshot(ledgerId: string): Promise<AiVideoBudgetLedgerSnapshot | null>;
}

function assertBudgetCaps(row: BudgetLedgerRow, input: AiVideoBudgetReserveInput) {
  const outstandingSeconds = row.reservedSeconds + row.committedSeconds;
  const outstandingUsd = row.reservedUsd + row.committedUsd;
  if (row.scopeKind === "PROJECT") {
    if (
      input.caps.projectMaxSeconds !== undefined &&
      outstandingSeconds + input.estimatedBilledSeconds > input.caps.projectMaxSeconds
    ) {
      throw new AiVideoBudgetCapError(
        `Project AI-video seconds cap reached (${input.caps.projectMaxSeconds}s).`,
      );
    }
    if (
      input.caps.projectMaxUsd !== undefined &&
      outstandingUsd + input.estimatedUsd > input.caps.projectMaxUsd
    ) {
      throw new AiVideoBudgetCapError(
        `Project AI-video budget cap reached ($${input.caps.projectMaxUsd}).`,
      );
    }
  }
  if (row.scopeKind === "USER_WINDOW") {
    if (
      input.caps.userWindowMaxSeconds !== undefined &&
      outstandingSeconds + input.estimatedBilledSeconds > input.caps.userWindowMaxSeconds
    ) {
      throw new AiVideoBudgetCapError(
        `User AI-video seconds cap reached (${input.caps.userWindowMaxSeconds}s).`,
      );
    }
    if (
      input.caps.userWindowMaxUsd !== undefined &&
      outstandingUsd + input.estimatedUsd > input.caps.userWindowMaxUsd
    ) {
      throw new AiVideoBudgetCapError(
        `User AI-video budget cap reached ($${input.caps.userWindowMaxUsd}).`,
      );
    }
  }
}

function applyBudgetReserve(row: BudgetLedgerRow, input: AiVideoBudgetReserveInput): BudgetLedgerRow {
  return {
    ...row,
    reservedSeconds: roundMeasure(row.reservedSeconds + input.estimatedBilledSeconds),
    reservedUsd: roundMeasure(row.reservedUsd + input.estimatedUsd),
    attempts: row.attempts + 1,
  };
}

function applyBudgetRelease(row: BudgetLedgerRow, reservation: AiVideoBudgetReservationRecord): BudgetLedgerRow {
  return {
    ...row,
    reservedSeconds: roundMeasure(row.reservedSeconds - reservation.estimatedBilledSeconds),
    reservedUsd: roundMeasure(row.reservedUsd - reservation.estimatedUsd),
  };
}

/** Rejects NaN, Infinity, and negatives before any ledger mutation. */
function assertReconcileMeasure(
  seconds: number,
  usdPerSecond: number,
): { actualBilledSeconds: number; actualUsd: number } {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(usdPerSecond) || usdPerSecond < 0) {
    throw new Error("Billed seconds and USD must be finite and greater than or equal to 0.");
  }
  const actualBilledSeconds = roundMeasure(seconds);
  const actualUsd = roundMeasure(actualBilledSeconds * usdPerSecond);
  if (
    !Number.isFinite(actualBilledSeconds) ||
    actualBilledSeconds < 0 ||
    !Number.isFinite(actualUsd) ||
    actualUsd < 0
  ) {
    throw new Error("Billed seconds and USD must be finite and greater than or equal to 0.");
  }
  return { actualBilledSeconds, actualUsd };
}

function applyBudgetReconcile(
  row: BudgetLedgerRow,
  reservation: AiVideoBudgetReservationRecord,
  actualBilledSeconds: number,
): BudgetLedgerRow {
  const actualUsd = roundMeasure(actualBilledSeconds * reservation.usdPerSecond);
  return {
    ...row,
    reservedSeconds: roundMeasure(row.reservedSeconds - reservation.estimatedBilledSeconds),
    committedSeconds: roundMeasure(row.committedSeconds + actualBilledSeconds),
    reservedUsd: roundMeasure(row.reservedUsd - reservation.estimatedUsd),
    committedUsd: roundMeasure(row.committedUsd + actualUsd),
  };
}

function budgetLedgerIds(input: AiVideoBudgetReserveInput): string[] {
  return [
    projectBudgetLedgerId(input.projectId),
    userWindowBudgetLedgerId(input.userId, input.windowKey),
  ].sort();
}

export class MemoryAiVideoBudget implements AiVideoBudgetPort {
  private readonly ledgers = new Map<string, BudgetLedgerRow>();
  private readonly reservations = new Map<string, AiVideoBudgetReservationRecord>();
  private readonly byKey = new Map<string, string>();
  private chain: Promise<unknown> = Promise.resolve();

  async reserve(input: AiVideoBudgetReserveInput): Promise<AiVideoBudgetReservationRecord> {
    return this.exclusive(() => {
      const existingId = this.byKey.get(input.idempotencyKey);
      if (existingId) {
        return this.copy(this.must(existingId));
      }
      const ids = budgetLedgerIds(input);
      const rows = ids.map((id) => this.ledgers.get(id) ?? emptyBudgetLedger(id, input));
      for (const row of rows) {
        assertBudgetCaps(row, input);
      }
      const now = new Date();
      const created: AiVideoBudgetReservationRecord = {
        id: randomUUID(),
        projectId: input.projectId,
        userId: input.userId,
        ledgerIds: ids,
        laneId: input.laneId,
        providerKey: input.providerKey,
        idempotencyKey: input.idempotencyKey,
        estimatedBilledSeconds: input.estimatedBilledSeconds,
        usdPerSecond: input.usdPerSecond,
        estimatedUsd: input.estimatedUsd,
        actualBilledSeconds: null,
        actualUsd: null,
        status: "RESERVED",
        settleReason: null,
        gatewayReservationId: input.gatewayReservationId ?? null,
        createdAt: now,
        settledAt: null,
      };
      for (const row of rows) {
        this.ledgers.set(row.id, applyBudgetReserve(row, input));
      }
      this.reservations.set(created.id, created);
      this.byKey.set(created.idempotencyKey, created.id);
      return this.copy(created);
    });
  }

  async release(id: string, reason: string): Promise<AiVideoBudgetReservationRecord> {
    return this.exclusive(() => this.settle(id, "release", reason));
  }

  async reconcile(
    id: string,
    input: { actualBilledSeconds: number; reason: string },
  ): Promise<AiVideoBudgetReservationRecord> {
    return this.exclusive(() => this.settle(id, "reconcile", input.reason, input.actualBilledSeconds));
  }

  async markUnreconciled(id: string, reason: string): Promise<AiVideoBudgetReservationRecord> {
    return this.exclusive(() => this.settle(id, "unreconcile", reason));
  }

  async rememberGatewayReservationId(
    id: string,
    gatewayReservationId: string,
  ): Promise<AiVideoBudgetReservationRecord> {
    return this.exclusive(() => {
      const row = this.must(id);
      if (!row.gatewayReservationId) {
        row.gatewayReservationId = gatewayReservationId;
      }
      return this.copy(row);
    });
  }

  async snapshot(ledgerId: string): Promise<AiVideoBudgetLedgerSnapshot | null> {
    const row = this.ledgers.get(ledgerId);
    return row ? { ...row } : null;
  }

  private settle(
    id: string,
    action: "release" | "reconcile" | "unreconcile",
    reason: string,
    actualBilledSeconds?: number,
  ): AiVideoBudgetReservationRecord {
    const row = this.must(id);
    const transition = settleTransition(row.status, action);
    if (transition.kind === "reject") {
      throw new Error(transition.message);
    }
    if (transition.kind === "noop") {
      return this.copy(row);
    }
    if (action === "release") {
      for (const ledgerId of row.ledgerIds) {
        const ledger = this.ledgers.get(ledgerId);
        if (ledger) this.ledgers.set(ledgerId, applyBudgetRelease(ledger, row));
      }
    } else if (action === "reconcile") {
      const measured = assertReconcileMeasure(
        actualBilledSeconds ?? row.estimatedBilledSeconds,
        row.usdPerSecond,
      );
      for (const ledgerId of row.ledgerIds) {
        const ledger = this.ledgers.get(ledgerId);
        if (ledger) this.ledgers.set(ledgerId, applyBudgetReconcile(ledger, row, measured.actualBilledSeconds));
      }
      row.actualBilledSeconds = measured.actualBilledSeconds;
      row.actualUsd = measured.actualUsd;
    }
    row.status = transition.status;
    row.settleReason = reason;
    row.settledAt = new Date();
    return this.copy(row);
  }

  private must(id: string): AiVideoBudgetReservationRecord {
    const row = this.reservations.get(id);
    if (!row) throw new Error(`Budget reservation ${id} was not found.`);
    return row;
  }

  private copy(row: AiVideoBudgetReservationRecord): AiVideoBudgetReservationRecord {
    return { ...row, ledgerIds: [...row.ledgerIds] };
  }

  private exclusive<T>(fn: () => T): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function emptyBudgetLedger(id: string, input: AiVideoBudgetReserveInput): BudgetLedgerRow {
  const projectId = projectBudgetLedgerId(input.projectId);
  if (id === projectId) {
    return {
      id,
      scopeKind: "PROJECT",
      projectId: input.projectId,
      userId: null,
      windowKey: null,
      reservedSeconds: 0,
      committedSeconds: 0,
      reservedUsd: 0,
      committedUsd: 0,
      attempts: 0,
    };
  }
  return {
    id,
    scopeKind: "USER_WINDOW",
    projectId: null,
    userId: input.userId,
    windowKey: input.windowKey,
    reservedSeconds: 0,
    committedSeconds: 0,
    reservedUsd: 0,
    committedUsd: 0,
    attempts: 0,
  };
}

type BudgetDb = Pick<PrismaClient, "aiVideoBudgetLedger" | "aiVideoBudgetReservation" | "$transaction">;

export class PrismaAiVideoBudget implements AiVideoBudgetPort {
  constructor(private readonly db: BudgetDb) {}

  async reserve(input: AiVideoBudgetReserveInput): Promise<AiVideoBudgetReservationRecord> {
    const ledgerIds = budgetLedgerIds(input);
    const created = await this.db.$transaction(async (tx) => {
      for (const id of ledgerIds) {
        const kind = id.startsWith("project:") ? "PROJECT" : "USER_WINDOW";
        await tx.$executeRaw`
          INSERT INTO ai_video_budget_ledger (
            id, "scopeKind", "projectId", "userId", "windowKey",
            "reservedSeconds", "committedSeconds", "reservedUsd", "committedUsd", "attempts",
            "createdAt", "updatedAt"
          )
          VALUES (
            ${id},
            ${kind},
            ${kind === "PROJECT" ? input.projectId : null},
            ${kind === "USER_WINDOW" ? input.userId : null},
            ${kind === "USER_WINDOW" ? input.windowKey : null},
            0, 0, 0, 0, 0, NOW(), NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `;
        await tx.$queryRaw`SELECT id FROM ai_video_budget_ledger WHERE id = ${id} FOR UPDATE`;
      }
      const existing = await tx.aiVideoBudgetReservation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return existing;
      const locked = await tx.aiVideoBudgetLedger.findMany({ where: { id: { in: ledgerIds } } });
      for (const row of locked) {
        assertBudgetCaps(toBudgetSnapshot(row), input);
      }
      const reservation = await tx.aiVideoBudgetReservation.create({
        data: {
          projectId: input.projectId,
          userId: input.userId,
          ledgerIds,
          laneId: input.laneId,
          providerKey: input.providerKey,
          idempotencyKey: input.idempotencyKey,
          estimatedBilledSeconds: input.estimatedBilledSeconds,
          usdPerSecond: input.usdPerSecond,
          estimatedUsd: input.estimatedUsd,
          status: "RESERVED",
          gatewayReservationId: input.gatewayReservationId ?? null,
        },
      });
      for (const row of locked) {
        const next = applyBudgetReserve(toBudgetSnapshot(row), input);
        await tx.aiVideoBudgetLedger.update({
          where: { id: row.id },
          data: {
            reservedSeconds: next.reservedSeconds,
            reservedUsd: next.reservedUsd,
            attempts: next.attempts,
          },
        });
      }
      return reservation;
    });
    return toBudgetReservation(created);
  }

  async release(id: string, reason: string): Promise<AiVideoBudgetReservationRecord> {
    return this.settle(id, "release", reason);
  }

  async reconcile(
    id: string,
    input: { actualBilledSeconds: number; reason: string },
  ): Promise<AiVideoBudgetReservationRecord> {
    return this.settle(id, "reconcile", input.reason, input.actualBilledSeconds);
  }

  async markUnreconciled(id: string, reason: string): Promise<AiVideoBudgetReservationRecord> {
    return this.settle(id, "unreconcile", reason);
  }

  async rememberGatewayReservationId(
    id: string,
    gatewayReservationId: string,
  ): Promise<AiVideoBudgetReservationRecord> {
    await this.db.aiVideoBudgetReservation.updateMany({
      where: { id, gatewayReservationId: null },
      data: { gatewayReservationId },
    });
    const row = await this.db.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id } });
    return toBudgetReservation(row);
  }

  async snapshot(ledgerId: string): Promise<AiVideoBudgetLedgerSnapshot | null> {
    const row = await this.db.aiVideoBudgetLedger.findUnique({ where: { id: ledgerId } });
    return row ? toBudgetSnapshot(row) : null;
  }

  private async settle(
    id: string,
    action: "release" | "reconcile" | "unreconcile",
    reason: string,
    actualBilledSeconds?: number,
  ): Promise<AiVideoBudgetReservationRecord> {
    const updated = await this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_video_budget_reservation WHERE id = ${id} FOR UPDATE
      `;
      if (!locked[0]) {
        throw new Error(`Budget reservation ${id} was not found.`);
      }
      const current = await tx.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id } });
      const ledgerIds = [...current.ledgerIds].sort();
      for (const ledgerId of ledgerIds) {
        await tx.$queryRaw`SELECT id FROM ai_video_budget_ledger WHERE id = ${ledgerId} FOR UPDATE`;
      }
      const transition = settleTransition(current.status, action);
      if (transition.kind === "reject") {
        throw new Error(transition.message);
      }
      if (transition.kind === "noop") return current;
      const reservation = toBudgetReservation(current);
      if (action === "release") {
        for (const ledgerId of ledgerIds) {
          const ledger = await tx.aiVideoBudgetLedger.findUniqueOrThrow({ where: { id: ledgerId } });
          const next = applyBudgetRelease(toBudgetSnapshot(ledger), reservation);
          await tx.aiVideoBudgetLedger.update({
            where: { id: ledgerId },
            data: { reservedSeconds: next.reservedSeconds, reservedUsd: next.reservedUsd },
          });
        }
      } else if (action === "reconcile") {
        const measured = assertReconcileMeasure(
          actualBilledSeconds ?? reservation.estimatedBilledSeconds,
          reservation.usdPerSecond,
        );
        for (const ledgerId of ledgerIds) {
          const ledger = await tx.aiVideoBudgetLedger.findUniqueOrThrow({ where: { id: ledgerId } });
          const next = applyBudgetReconcile(toBudgetSnapshot(ledger), reservation, measured.actualBilledSeconds);
          await tx.aiVideoBudgetLedger.update({
            where: { id: ledgerId },
            data: {
              reservedSeconds: next.reservedSeconds,
              committedSeconds: next.committedSeconds,
              reservedUsd: next.reservedUsd,
              committedUsd: next.committedUsd,
            },
          });
        }
        return tx.aiVideoBudgetReservation.update({
          where: { id },
          data: {
            status: transition.status,
            settleReason: reason,
            settledAt: new Date(),
            actualBilledSeconds: measured.actualBilledSeconds,
            actualUsd: measured.actualUsd,
          },
        });
      }
      return tx.aiVideoBudgetReservation.update({
        where: { id },
        data: { status: transition.status, settleReason: reason, settledAt: new Date() },
      });
    });
    const record = toBudgetReservation(updated);
    await recordSettledAiVideoSeconds(record);
    return record;
  }
}

function toBudgetSnapshot(row: {
  id: string;
  scopeKind: string;
  projectId: string | null;
  userId: string | null;
  windowKey: string | null;
  reservedSeconds: number;
  committedSeconds: number;
  reservedUsd: number;
  committedUsd: number;
  attempts: number;
}): AiVideoBudgetLedgerSnapshot {
  return { ...row };
}

function toBudgetReservation(row: {
  id: string;
  projectId: string;
  userId: string;
  ledgerIds: string[];
  laneId: string;
  providerKey: string;
  idempotencyKey: string;
  estimatedBilledSeconds: number;
  usdPerSecond: number;
  estimatedUsd: number;
  actualBilledSeconds: number | null;
  actualUsd: number | null;
  status: string;
  settleReason: string | null;
  gatewayReservationId: string | null;
  createdAt: Date;
  settledAt: Date | null;
}): AiVideoBudgetReservationRecord {
  return { ...row, ledgerIds: [...row.ledgerIds] };
}

export type { ReservationStatus };
