import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import type { EnqueueJobInput, JobQueuePort, JobRecord } from "@/server/ports/jobs";
import { JobStatus } from "@/server/domain/status";
import { logger } from "@/lib/logger";

type PrismaClientLike = Pick<typeof prisma, "job">;

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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed queue. Jobs persist; no worker claims them in Phase 1.
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
}
