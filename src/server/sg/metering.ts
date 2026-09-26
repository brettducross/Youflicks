import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import { AssetCapability } from "@/server/ports/capabilities";
import { roundMeasure } from "@/server/sg/lane-rate";
import { EngineCostKind, UsageKind } from "@/server/usage/types";

/**
 * Money identity for one settled app hold.
 * Seconds and the outcome come from the reservation row, never from an attempt or a slot.
 */
export type MeteredBudgetHold = {
  id: string;
  userId: string;
  projectId: string;
  providerKey: string;
  status: string;
  settleReason: string | null;
  actualBilledSeconds: number | null;
};

/**
 * Idempotency key for the AI_VIDEO_SECONDS usage row.
 * The reservation id is stable across attempt numbers, re-settle, and webhook/poll retries.
 * Using it as the primary key needs no new column: a second insert conflicts and is a no-op.
 */
export function aiVideoSecondsUsageEventId(budgetReservationId: string): string {
  return `sg:${UsageKind.AI_VIDEO_SECONDS}:${budgetReservationId}`;
}

export function aiVideoSecondsCostEventId(budgetReservationId: string): string {
  return `sg:ENGINE_COST:${UsageKind.AI_VIDEO_SECONDS}:${budgetReservationId}`;
}

/**
 * Confirmed billed seconds on a settled hold.
 * UNRECONCILED and RELEASED (including CAP_DENIED and a non-billable failure) return null.
 * A billed failure is RECONCILED with actualBilledSeconds > 0.
 */
export function meterableBilledSeconds(hold: MeteredBudgetHold): number | null {
  if (hold.status !== "RECONCILED") {
    return null;
  }
  const seconds = hold.actualBilledSeconds;
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return roundMeasure(seconds);
}

/**
 * Writes AI_VIDEO_SECONDS and its ESTIMATED engine-cost row once per reservation.
 * Safe to call on every settle, including a no-op re-settle. Does not read the lane registry.
 * A write failure is logged and does not fail the settle: the hold is already committed,
 * and a later settle of the same reservation retries the insert.
 */
export async function recordSettledAiVideoSeconds(hold: MeteredBudgetHold): Promise<void> {
  const seconds = meterableBilledSeconds(hold);
  if (seconds == null) {
    return;
  }
  const recordedAt = new Date();
  try {
    await prisma.usageEvent.create({
      data: {
        id: aiVideoSecondsUsageEventId(hold.id),
        userId: hold.userId,
        projectId: hold.projectId,
        kind: UsageKind.AI_VIDEO_SECONDS,
        quantity: seconds,
        outcome: hold.settleReason ?? hold.status,
        recordedAt,
        engineCosts: {
          create: {
            id: aiVideoSecondsCostEventId(hold.id),
            providerKey: hold.providerKey,
            capability: AssetCapability.VIDEO_GENERATION,
            costUnits: seconds,
            costKind: EngineCostKind.ESTIMATED,
            recordedAt,
          },
        },
      },
    });
    logger.info("usage.recorded", {
      userId: hold.userId,
      projectId: hold.projectId,
      kind: UsageKind.AI_VIDEO_SECONDS,
      quantity: seconds,
      outcome: hold.settleReason ?? hold.status,
      budgetReservationId: hold.id,
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      return;
    }
    logger.error("usage.record_failed", {
      userId: hold.userId,
      kind: UsageKind.AI_VIDEO_SECONDS,
      budgetReservationId: hold.id,
      error: error instanceof Error ? error.message : "Usage meter write failed.",
    });
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
