import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import {
  DEFAULT_RECORDED_ROUTING_MODE,
  type AttemptOutcome,
} from "@/server/sg/constants";
import { assertIdentityEvidence, IdentityEvidenceError } from "@/server/sg/identity-evidence";
import { DEFAULT_SG_LANE_REGISTRY_PATH, roundMeasure } from "@/server/sg/lane-rate";

/**
 * E-R1 working default. Temporary labeled Wan exception while testing stays
 * internal. Recording LEGACY is not routing and does not read SG_ROUTING_MODE.
 */
export const LEGACY_DECISION_REASON =
  "LEGACY records the existing single-lane path. Routing and regen ceilings are not applied.";

/** PR-1 registry file generation. PR-4 owns a version field inside the file. */
export const SG_LANE_REGISTRY_VERSION_V0 = "v0";

/**
 * Recording labels copied from lock §4 so classAttemptNo has a stable class.
 * Not eligibility, not a registry lookup, and not a routing decision.
 * Unknown lane ids stay unclassified so they are not counted as draft-cost or standard.
 */
const RECORDED_LANE_CLASS_BY_ID: Readonly<Record<string, string>> = {
  "r1-wan27-replicate": "standard",
  "boreal-720": "draft-cost",
  "pruna-480-cost": "draft-cost",
  "pruna-768-cost": "draft-cost",
  "h3turbo-768": "draft-quality",
  "veo31lite-720": "draft-quality",
  "pruna-768-quality": "draft-quality",
  "kling3-pro-audio-off": "premium",
  "seedance2-fast-720": "premium",
};

export const UNCLASSIFIED_LANE_CLASS = "unclassified";

export function recordedLaneClass(laneId: string): string {
  return RECORDED_LANE_CLASS_BY_ID[laneId] ?? UNCLASSIFIED_LANE_CLASS;
}

export function fulfillmentSlotKey(input: {
  timelineId: string;
  timelineVersion: number;
  role: string;
  storySceneId?: string | null;
}): string {
  const scene =
    input.storySceneId && input.storySceneId.length > 0 ? input.storySceneId : "-";
  return `${input.timelineId}:${input.timelineVersion}:${input.role}:${scene}`;
}

export type RegistryStamp = {
  registryVersion: string;
  registrySha256: string;
};

export function readRegistryStamp(path?: string): RegistryStamp {
  const file = path && path.length > 0 ? path : registryPathFromEnv();
  try {
    const raw = readFileSync(file);
    return {
      registryVersion: SG_LANE_REGISTRY_VERSION_V0,
      registrySha256: createHash("sha256").update(raw).digest("hex"),
    };
  } catch {
    return { registryVersion: "unavailable", registrySha256: "unavailable" };
  }
}

export class ShotFulfillmentError extends Error {
  readonly code = "SHOT_FULFILLMENT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ShotFulfillmentError";
  }
}

export type EnsureSlotInput = {
  projectId: string;
  timelineId: string;
  timelineVersion: number;
  role: string;
  storySceneId?: string | null;
  sourceMediaAssetId?: string | null;
  identityEvidence?: unknown;
};

export type BeginAttemptInput = {
  shotFulfillmentId: string;
  laneClass: string;
  laneId: string;
  providerKey: string;
  modelId?: string | null;
  requiredScopes: string[];
  jobId?: string | null;
  budgetReservationId?: string | null;
  estimatedBilledSeconds: number;
  usdPerSecond: number;
  estimatedUsd: number;
};

export type FinishAttemptInput = {
  attemptId: string;
  outcome: AttemptOutcome;
  failureCode?: string | null;
  budgetReservationId?: string | null;
  gatewayJobId?: string | null;
  gatewayReservationId?: string | null;
  actualBilledSeconds?: number | null;
  actualUsd?: number | null;
  generatedAssetId?: string | null;
  outputWidth?: number | null;
  outputHeight?: number | null;
};

export class PrismaShotFulfillment {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Create-or-get by the deterministic slot key. A newer timeline version
   * marks older slots SUPERSEDED. Does not choose a lane.
   */
  async ensureSlot(input: EnsureSlotInput) {
    const evidence =
      input.identityEvidence === undefined
        ? undefined
        : assertIdentityEvidence(input.identityEvidence);
    const slotKey = fulfillmentSlotKey(input);
    const stamp = readRegistryStamp();
    const storySceneId = input.storySceneId && input.storySceneId.length > 0 ? input.storySceneId : null;

    try {
      return await this.db.$transaction(async (tx) => {
        await tx.shotFulfillment.updateMany({
          where: {
            projectId: input.projectId,
            timelineVersion: { lt: input.timelineVersion },
            status: { not: "SUPERSEDED" },
          },
          data: { status: "SUPERSEDED" },
        });
        const existing = await tx.shotFulfillment.findUnique({
          where: { projectId_slotKey: { projectId: input.projectId, slotKey } },
        });
        if (existing) {
          return existing;
        }
        const newer = await tx.shotFulfillment.findFirst({
          where: {
            projectId: input.projectId,
            timelineVersion: { gt: input.timelineVersion },
          },
          select: { id: true },
        });
        return tx.shotFulfillment.create({
          data: {
            projectId: input.projectId,
            timelineId: input.timelineId,
            timelineVersion: input.timelineVersion,
            role: input.role,
            storySceneId,
            slotKey,
            scope: "IDENTITY",
            requiredScopes: ["IDENTITY"],
            identityState: "UNKNOWN",
            identityEvidence: evidence as Prisma.InputJsonValue | undefined,
            treatment: "GENERATE",
            status: newer ? "SUPERSEDED" : "PLANNED",
            routingMode: DEFAULT_RECORDED_ROUTING_MODE,
            decisionReason: LEGACY_DECISION_REASON,
            registryVersion: stamp.registryVersion,
            registrySha256: stamp.registrySha256,
            sourceMediaAssetId: input.sourceMediaAssetId ?? null,
          },
        });
      });
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
      const existing = await this.db.shotFulfillment.findUnique({
        where: { projectId_slotKey: { projectId: input.projectId, slotKey } },
      });
      if (!existing) {
        throw error;
      }
      return existing;
    }
  }

  /** Capability miss and other non-attempts. Does not invent an attempt row. */
  async markUnattemptedFailure(shotFulfillmentId: string, generatedAssetId?: string) {
    return this.db.$transaction(async (tx) => {
      const slot = await tx.shotFulfillment.findUniqueOrThrow({
        where: { id: shotFulfillmentId },
      });
      if (generatedAssetId) {
        await assertSameProjectAsset(tx, slot.projectId, generatedAssetId);
      }
      return tx.shotFulfillment.update({
        where: { id: shotFulfillmentId },
        data: {
          status: "FAILED",
          generatedAssetId: generatedAssetId ?? slot.generatedAssetId,
        },
      });
    });
  }

  /**
   * A retried job may have left a PENDING row. Close it before the next
   * attempt on that same job. Concurrent jobs keep their own rows.
   */
  async abandonPendingAttempts(input: { shotFulfillmentId: string; jobId: string }) {
    await this.db.shotFulfillmentAttempt.updateMany({
      where: {
        shotFulfillmentId: input.shotFulfillmentId,
        jobId: input.jobId,
        outcome: "PENDING",
      },
      data: {
        outcome: "FAILED",
        failureCode: "INTERRUPTED",
        finishedAt: new Date(),
      },
    });
  }

  /**
   * Next 1-based attemptNo for the slot and classAttemptNo within laneClass.
   * The unique (slot, attemptNo) constraint plus a row lock retries conflicts.
   * Does not enforce regen ceilings.
   */
  async beginAttempt(input: BeginAttemptInput) {
    const maxTries = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxTries; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM shot_fulfillment WHERE id = ${input.shotFulfillmentId} FOR UPDATE
          `;
          if (!locked[0]) {
            throw new ShotFulfillmentError(`Shot fulfillment ${input.shotFulfillmentId} was not found.`);
          }
          const slot = await tx.shotFulfillment.findUniqueOrThrow({
            where: { id: input.shotFulfillmentId },
          });
          const existing = await tx.shotFulfillmentAttempt.findMany({
            where: { shotFulfillmentId: input.shotFulfillmentId },
            select: { attemptNo: true, laneClass: true },
          });
          const attemptNo = existing.reduce((max, row) => Math.max(max, row.attemptNo), 0) + 1;
          const classAttemptNo =
            existing.filter((row) => row.laneClass === input.laneClass).length + 1;
          const created = await tx.shotFulfillmentAttempt.create({
            data: {
              shotFulfillmentId: input.shotFulfillmentId,
              attemptNo,
              classAttemptNo,
              laneClass: input.laneClass,
              laneId: input.laneId,
              providerKey: input.providerKey,
              modelId: input.modelId ?? null,
              requiredScopes: input.requiredScopes,
              jobId: input.jobId ?? null,
              budgetReservationId: input.budgetReservationId ?? null,
              estimatedBilledSeconds: input.estimatedBilledSeconds,
              usdPerSecond: input.usdPerSecond,
              estimatedUsd: input.estimatedUsd,
              outcome: "PENDING",
            },
          });
          await tx.shotFulfillment.update({
            where: { id: input.shotFulfillmentId },
            data: {
              attemptsTotal: existing.length + 1,
              status: slot.status === "SUPERSEDED" ? "SUPERSEDED" : "IN_PROGRESS",
              currentLaneClass: input.laneClass,
              currentLaneId: input.laneId,
              currentProviderKey: input.providerKey,
            },
          });
          return created;
        });
      } catch (error) {
        lastError = error;
        if (!isUniqueConflict(error) || attempt === maxTries - 1) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new ShotFulfillmentError("Could not record an attempt.");
  }

  /**
   * Writes the terminal outcome. The first terminal outcome wins.
   * generatedAssetId must be a GeneratedAsset in the same project.
   */
  async finishAttempt(input: FinishAttemptInput) {
    return this.db.$transaction(async (tx) => {
      const current = await tx.shotFulfillmentAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      const slot = await tx.shotFulfillment.findUniqueOrThrow({
        where: { id: current.shotFulfillmentId },
      });
      if (input.generatedAssetId) {
        await assertSameProjectAsset(tx, slot.projectId, input.generatedAssetId);
      }
      if (current.outcome !== "PENDING" && current.outcome !== input.outcome) {
        return current;
      }
      const actualBilledSeconds = input.actualBilledSeconds ?? current.actualBilledSeconds;
      const actualUsd =
        input.actualUsd ??
        (actualBilledSeconds != null
          ? roundMeasure(actualBilledSeconds * current.usdPerSecond)
          : current.actualUsd);
      const updated = await tx.shotFulfillmentAttempt.update({
        where: { id: current.id },
        data: {
          outcome: input.outcome,
          failureCode: input.failureCode === undefined ? current.failureCode : input.failureCode,
          budgetReservationId: input.budgetReservationId ?? current.budgetReservationId,
          gatewayJobId: input.gatewayJobId ?? current.gatewayJobId,
          gatewayReservationId: input.gatewayReservationId ?? current.gatewayReservationId,
          actualBilledSeconds,
          actualUsd: actualBilledSeconds == null ? null : actualUsd,
          generatedAssetId: input.generatedAssetId ?? current.generatedAssetId,
          outputWidth: input.outputWidth ?? current.outputWidth,
          outputHeight: input.outputHeight ?? current.outputHeight,
          finishedAt: current.finishedAt ?? new Date(),
        },
      });
      const attemptsTotal = await tx.shotFulfillmentAttempt.count({
        where: { shotFulfillmentId: slot.id },
      });
      await tx.shotFulfillment.update({
        where: { id: slot.id },
        data: {
          attemptsTotal,
          status: slot.status === "SUPERSEDED" ? "SUPERSEDED" : slotStatusForOutcome(input.outcome),
          generatedAssetId: input.generatedAssetId ?? slot.generatedAssetId,
          currentLaneClass: current.laneClass,
          currentLaneId: current.laneId,
          currentProviderKey: current.providerKey,
        },
      });
      return updated;
    });
  }

  /**
   * Job retry found a READY asset for this job. Link it and close a PENDING
   * attempt for that job without starting another one.
   */
  async attachReadyAsset(input: {
    shotFulfillmentId: string;
    generatedAssetId: string;
    jobId: string;
  }) {
    return this.db.$transaction(async (tx) => {
      const slot = await tx.shotFulfillment.findUniqueOrThrow({
        where: { id: input.shotFulfillmentId },
      });
      await assertSameProjectAsset(tx, slot.projectId, input.generatedAssetId);
      const pending = await tx.shotFulfillmentAttempt.findFirst({
        where: {
          shotFulfillmentId: slot.id,
          jobId: input.jobId,
          outcome: "PENDING",
        },
        orderBy: { attemptNo: "desc" },
      });
      if (pending) {
        await tx.shotFulfillmentAttempt.update({
          where: { id: pending.id },
          data: {
            outcome: "SUCCEEDED",
            generatedAssetId: input.generatedAssetId,
            finishedAt: pending.finishedAt ?? new Date(),
          },
        });
      }
      const attemptsTotal = await tx.shotFulfillmentAttempt.count({
        where: { shotFulfillmentId: slot.id },
      });
      return tx.shotFulfillment.update({
        where: { id: slot.id },
        data: {
          attemptsTotal,
          generatedAssetId: slot.generatedAssetId ?? input.generatedAssetId,
          status: slot.status === "SUPERSEDED" ? "SUPERSEDED" : "FULFILLED",
        },
      });
    });
  }

  /** Write boundary for identityEvidence. Rejects before any update. */
  async setIdentityEvidence(shotFulfillmentId: string, evidence: unknown) {
    let parsed: Record<string, unknown>;
    try {
      parsed = assertIdentityEvidence(evidence);
    } catch (error) {
      if (error instanceof IdentityEvidenceError) {
        throw error;
      }
      throw error;
    }
    return this.db.shotFulfillment.update({
      where: { id: shotFulfillmentId },
      data: { identityEvidence: parsed as Prisma.InputJsonValue },
    });
  }
}

function slotStatusForOutcome(outcome: AttemptOutcome): string {
  if (outcome === "SUCCEEDED") {
    return "FULFILLED";
  }
  if (outcome === "PENDING") {
    return "IN_PROGRESS";
  }
  return "FAILED";
}

async function assertSameProjectAsset(
  tx: Pick<PrismaClient, "generatedAsset">,
  projectId: string,
  generatedAssetId: string,
) {
  const asset = await tx.generatedAsset.findFirst({
    where: { id: generatedAssetId, projectId },
    select: { id: true },
  });
  if (!asset) {
    throw new ShotFulfillmentError(
      "generatedAssetId must reference a GeneratedAsset in the same project.",
    );
  }
}

function registryPathFromEnv(): string {
  const path = process.env.SG_LANE_REGISTRY_PATH?.trim();
  return path && path.length > 0 ? path : DEFAULT_SG_LANE_REGISTRY_PATH;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export { IdentityEvidenceError };
