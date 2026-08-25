import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import type { EnqueueJobInput, FailJobInput, JobQueuePort, JobRecord } from "@/server/ports/jobs";
import { JobStatus } from "@/server/domain/status";
import { logger } from "@/lib/logger";

type PrismaClientLike = Pick<typeof prisma, "job">;

const DEFAULT_MAX_ATTEMPTS = 3;

function toRecord(row: {
  id: string;
  type: string;
  status: string;
  projectId: string | null;
  payload: Prisma.JsonValue;
  result: Prisma.JsonValue;
  error: string | null;
  attempts: number;
  runAfter: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): JobRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    projectId: row.projectId,
    payload: row.payload,
    result: row.result,
    error: row.error,
    attempts: row.attempts,
    runAfter: row.runAfter,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed queue. Workers claim PENDING rows when runAfter has passed.
 */
export class PostgresJobQueue implements JobQueuePort {
  constructor(private readonly db: PrismaClientLike = prisma) {}

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    const row = await this.db.job.create({
      data: {
        type: input.type,
        projectId: input.projectId ?? null,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        status: JobStatus.PENDING,
        runAfter: input.runAfter ?? new Date(),
      },
    });
    logger.info("jobs.enqueue", { jobId: row.id, type: row.type, projectId: row.projectId });
    return toRecord(row);
  }

  async get(id: string): Promise<JobRecord | null> {
    const row = await this.db.job.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async listByProject(projectId: string): Promise<JobRecord[]> {
    const rows = await this.db.job.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async claimNext(types?: string[]): Promise<JobRecord | null> {
    const now = new Date();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = await this.db.job.findFirst({
        where: {
          status: JobStatus.PENDING,
          runAfter: { lte: now },
          ...(types?.length ? { type: { in: types } } : {}),
        },
        orderBy: { runAfter: "asc" },
      });
      if (!candidate) {
        return null;
      }
      const claimed = await this.db.job.updateMany({
        where: { id: candidate.id, status: JobStatus.PENDING },
        data: {
          status: JobStatus.RUNNING,
          attempts: { increment: 1 },
          startedAt: now,
        },
      });
      if (claimed.count === 1) {
        const row = await this.db.job.findUniqueOrThrow({ where: { id: candidate.id } });
        return toRecord(row);
      }
    }
    return null;
  }

  async complete(id: string, result?: unknown): Promise<JobRecord> {
    const row = await this.db.job.update({
      where: { id },
      data: {
        status: JobStatus.SUCCEEDED,
        result: (result ?? {}) as Prisma.InputJsonValue,
        error: null,
        finishedAt: new Date(),
      },
    });
    logger.info("jobs.complete", { jobId: row.id, type: row.type });
    return toRecord(row);
  }

  async fail(id: string, input: FailJobInput): Promise<JobRecord> {
    const current = await this.db.job.findUniqueOrThrow({ where: { id } });
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const canRetry = Boolean(input.retry) && current.attempts < maxAttempts;

    const row = await this.db.job.update({
      where: { id },
      data: canRetry
        ? {
            status: JobStatus.PENDING,
            error: input.error,
            runAfter: input.retryAfter ?? new Date(Date.now() + current.attempts * 2000),
            finishedAt: null,
          }
        : {
            status: JobStatus.FAILED,
            error: input.error,
            finishedAt: new Date(),
          },
    });
    logger.warn("jobs.fail", {
      jobId: row.id,
      retry: canRetry,
      attempts: row.attempts,
    });
    return toRecord(row);
  }
}
