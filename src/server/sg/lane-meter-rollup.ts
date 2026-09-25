import type { PrismaClient } from "@/generated/prisma/client";
import { roundMeasure } from "@/server/sg/lane-rate";

/**
 * One ops row: lane × scope × UTC day.
 * Money is copied from the budget hold. Slot status and attempt actuals are not read.
 */
export type LaneScopeDayRow = {
  laneId: string;
  scope: string;
  day: string;
  attempts: number;
  /** Reconciled actual billed seconds. */
  billedSeconds: number;
  /** Estimate on reconciled, unreconciled, and still-reserved holds. Released holds are omitted. */
  estimatedUsd: number;
  /**
   * Reconciled actual USD. Null when the group has unreconciled exposure and no reconciled actual,
   * so an unknown outcome is not reported as $0.
   */
  actualUsd: number | null;
  unreconciledBilledSeconds: number;
  unreconciledUsd: number;
  reservedBilledSeconds: number;
  reservedUsd: number;
  outcomes: Record<string, number>;
};

export type RollupAttempt = {
  laneId: string;
  outcome: string;
  startedAt: Date;
  budgetReservationId: string | null;
  scope: string;
};

export type RollupHold = {
  id: string;
  laneId: string;
  status: string;
  estimatedBilledSeconds: number;
  estimatedUsd: number;
  actualBilledSeconds: number | null;
  actualUsd: number | null;
  settledAt: Date | null;
  createdAt: Date;
};

type Bucket = {
  laneId: string;
  scope: string;
  day: string;
  attempts: number;
  billedSeconds: number;
  estimatedUsd: number;
  actualUsdSum: number;
  actualKnown: boolean;
  sawUnreconciled: boolean;
  unreconciledBilledSeconds: number;
  unreconciledUsd: number;
  reservedBilledSeconds: number;
  reservedUsd: number;
  outcomes: Record<string, number>;
};

export function buildLaneScopeDayRollups(
  attempts: readonly RollupAttempt[],
  holds: readonly RollupHold[],
): LaneScopeDayRow[] {
  const holdById = new Map(holds.map((hold) => [hold.id, hold]));
  const seenHolds = new Set<string>();
  const buckets = new Map<string, Bucket>();

  for (const attempt of attempts) {
    const hold = attempt.budgetReservationId
      ? holdById.get(attempt.budgetReservationId)
      : undefined;
    const laneId = hold?.laneId ?? attempt.laneId;
    const when = hold?.settledAt ?? hold?.createdAt ?? attempt.startedAt;
    const day = utcDay(when);
    const key = `${laneId}\u0000${attempt.scope}\u0000${day}`;
    const bucket = buckets.get(key) ?? emptyBucket(laneId, attempt.scope, day);
    bucket.attempts += 1;
    bucket.outcomes[attempt.outcome] = (bucket.outcomes[attempt.outcome] ?? 0) + 1;
    if (hold && !seenHolds.has(hold.id)) {
      seenHolds.add(hold.id);
      addHoldMoney(bucket, hold);
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map(toRow)
    .sort((a, b) => a.day.localeCompare(b.day) || a.laneId.localeCompare(b.laneId) || a.scope.localeCompare(b.scope));
}

export async function readLaneScopeDayRollups(db: PrismaClient): Promise<LaneScopeDayRow[]> {
  const attempts = await db.shotFulfillmentAttempt.findMany({
    include: { shot: { select: { scope: true } } },
  });
  const reservationIds = [
    ...new Set(
      attempts
        .map((attempt) => attempt.budgetReservationId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const holds =
    reservationIds.length === 0
      ? []
      : await db.aiVideoBudgetReservation.findMany({
          where: { id: { in: reservationIds } },
        });
  return buildLaneScopeDayRollups(
    attempts.map((attempt) => ({
      laneId: attempt.laneId,
      outcome: attempt.outcome,
      startedAt: attempt.startedAt,
      budgetReservationId: attempt.budgetReservationId,
      scope: attempt.shot.scope,
    })),
    holds.map((hold) => ({
      id: hold.id,
      laneId: hold.laneId,
      status: hold.status,
      estimatedBilledSeconds: hold.estimatedBilledSeconds,
      estimatedUsd: hold.estimatedUsd,
      actualBilledSeconds: hold.actualBilledSeconds,
      actualUsd: hold.actualUsd,
      settledAt: hold.settledAt,
      createdAt: hold.createdAt,
    })),
  );
}

function addHoldMoney(bucket: Bucket, hold: RollupHold) {
  if (hold.status === "RECONCILED") {
    bucket.billedSeconds = roundMeasure(bucket.billedSeconds + (hold.actualBilledSeconds ?? 0));
    bucket.estimatedUsd = roundMeasure(bucket.estimatedUsd + hold.estimatedUsd);
    bucket.actualUsdSum = roundMeasure(bucket.actualUsdSum + (hold.actualUsd ?? 0));
    bucket.actualKnown = true;
    return;
  }
  if (hold.status === "UNRECONCILED") {
    bucket.unreconciledBilledSeconds = roundMeasure(
      bucket.unreconciledBilledSeconds + hold.estimatedBilledSeconds,
    );
    bucket.unreconciledUsd = roundMeasure(bucket.unreconciledUsd + hold.estimatedUsd);
    bucket.estimatedUsd = roundMeasure(bucket.estimatedUsd + hold.estimatedUsd);
    bucket.sawUnreconciled = true;
    return;
  }
  if (hold.status === "RESERVED") {
    bucket.reservedBilledSeconds = roundMeasure(
      bucket.reservedBilledSeconds + hold.estimatedBilledSeconds,
    );
    bucket.reservedUsd = roundMeasure(bucket.reservedUsd + hold.estimatedUsd);
    bucket.estimatedUsd = roundMeasure(bucket.estimatedUsd + hold.estimatedUsd);
  }
}

function toRow(bucket: Bucket): LaneScopeDayRow {
  let actualUsd: number | null;
  if (bucket.sawUnreconciled && !bucket.actualKnown) {
    actualUsd = null;
  } else if (bucket.actualKnown) {
    actualUsd = bucket.actualUsdSum;
  } else {
    actualUsd = 0;
  }
  return {
    laneId: bucket.laneId,
    scope: bucket.scope,
    day: bucket.day,
    attempts: bucket.attempts,
    billedSeconds: bucket.billedSeconds,
    estimatedUsd: bucket.estimatedUsd,
    actualUsd,
    unreconciledBilledSeconds: bucket.unreconciledBilledSeconds,
    unreconciledUsd: bucket.unreconciledUsd,
    reservedBilledSeconds: bucket.reservedBilledSeconds,
    reservedUsd: bucket.reservedUsd,
    outcomes: bucket.outcomes,
  };
}

function emptyBucket(laneId: string, scope: string, day: string): Bucket {
  return {
    laneId,
    scope,
    day,
    attempts: 0,
    billedSeconds: 0,
    estimatedUsd: 0,
    actualUsdSum: 0,
    actualKnown: false,
    sawUnreconciled: false,
    unreconciledBilledSeconds: 0,
    unreconciledUsd: 0,
    reservedBilledSeconds: 0,
    reservedUsd: 0,
    outcomes: {},
  };
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
