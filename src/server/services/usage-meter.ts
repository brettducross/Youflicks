import "server-only";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import type { UsageMeterPort } from "@/server/ports/usage-meter";
import {
  estimateEngineCostUnits,
  type EngineCostEstimator,
} from "@/server/usage/cost-table";
import {
  EngineCostKind,
  UsageOutcome,
  type EngineCostEventView,
  type RecordJobUsageInput,
  type RecordUsageInput,
  type UsageEventView,
  type UsageQuery,
} from "@/server/usage/types";

/**
 * Append-only ops meter. Separate from GenerationAuthorization (M8.2).
 * Never writes CreativePlan / Story / Timeline. Never calls Director.
 */
export class UsageMeterService implements UsageMeterPort {
  constructor(
    private readonly estimate: EngineCostEstimator = estimateEngineCostUnits,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(input: RecordUsageInput): Promise<UsageEventView> {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!user) {
      throw AppError.notFound("That account was not found.");
    }

    const recordedAt = input.recordedAt ?? this.now();
    const row = await prisma.usageEvent.create({
      data: {
        userId: input.userId,
        projectId: input.projectId ?? null,
        jobId: input.jobId ?? null,
        kind: input.kind,
        quantity: input.quantity,
        outcome: input.outcome ?? UsageOutcome.SUCCEEDED,
        recordedAt,
        engineCosts: input.engineCost
          ? {
              create: {
                jobId: input.engineCost.jobId ?? input.jobId ?? null,
                providerKey: input.engineCost.providerKey,
                capability: input.engineCost.capability,
                costUnits: input.engineCost.costUnits,
                costKind: input.engineCost.costKind ?? EngineCostKind.ESTIMATED,
                recordedAt,
              },
            }
          : undefined,
      },
      include: { engineCosts: true },
    });

    logger.info("usage.recorded", {
      userId: input.userId,
      kind: input.kind,
      quantity: input.quantity,
      outcome: row.outcome,
      jobId: input.jobId ?? null,
      costUnits: input.engineCost?.costUnits ?? null,
    });
    return toView(row);
  }

  /**
   * Job-hook helper. Estimates ops cost units and never throws —
   * metering must not fail Director / Asset / Render.
   */
  async recordJobUsage(input: RecordJobUsageInput): Promise<UsageEventView | null> {
    try {
      return await this.record({
        userId: input.userId,
        projectId: input.projectId,
        jobId: input.jobId,
        kind: input.kind,
        quantity: input.quantity,
        outcome: input.outcome ?? UsageOutcome.SUCCEEDED,
        engineCost: {
          providerKey: input.providerKey,
          capability: input.capability,
          costUnits: this.estimate(input.kind, input.quantity),
          costKind: input.costKind ?? EngineCostKind.ESTIMATED,
          jobId: input.jobId,
        },
      });
    } catch (error) {
      logger.error("usage.record_failed", {
        userId: input.userId,
        kind: input.kind,
        jobId: input.jobId ?? null,
        error: error instanceof Error ? error.message : "Usage meter write failed.",
      });
      return null;
    }
  }

  async listForUser(userId: string, query: UsageQuery = {}): Promise<UsageEventView[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw AppError.notFound("That account was not found.");
    }
    const rows = await prisma.usageEvent.findMany({
      where: {
        userId,
        kind: query.kind,
        jobId: query.jobId,
        recordedAt: query.since ? { gte: query.since } : undefined,
      },
      include: { engineCosts: true },
      orderBy: { recordedAt: "desc" },
    });
    return rows.map(toView);
  }

  async listForJob(jobId: string): Promise<UsageEventView[]> {
    const rows = await prisma.usageEvent.findMany({
      where: { jobId },
      include: { engineCosts: true },
      orderBy: { recordedAt: "asc" },
    });
    return rows.map(toView);
  }
}

function toView(row: {
  id: string;
  userId: string;
  projectId: string | null;
  jobId: string | null;
  kind: string;
  quantity: number;
  outcome: string;
  recordedAt: Date;
  engineCosts: Array<{
    id: string;
    usageEventId: string;
    jobId: string | null;
    providerKey: string;
    capability: string;
    costUnits: number;
    costKind: string;
    recordedAt: Date;
  }>;
}): UsageEventView {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    jobId: row.jobId,
    kind: row.kind,
    quantity: row.quantity,
    outcome: row.outcome,
    recordedAt: row.recordedAt.toISOString(),
    engineCosts: row.engineCosts.map(toCostView),
  };
}

function toCostView(row: {
  id: string;
  usageEventId: string;
  jobId: string | null;
  providerKey: string;
  capability: string;
  costUnits: number;
  costKind: string;
  recordedAt: Date;
}): EngineCostEventView {
  return {
    id: row.id,
    usageEventId: row.usageEventId,
    jobId: row.jobId,
    providerKey: row.providerKey,
    capability: row.capability,
    costUnits: row.costUnits,
    costKind: row.costKind,
    recordedAt: row.recordedAt.toISOString(),
  };
}
