import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { JobType } from "@/server/domain/status";
import type { JobQueuePort } from "@/server/ports/jobs";
import { DirectorService } from "@/server/services/director";

const DIRECT_TYPES = [JobType.AI_DIRECT];

export class DirectorWorker {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly director: DirectorService,
  ) {}

  async drain(limit = 20) {
    let processed = 0;
    while (processed < limit) {
      const ran = await this.processNext();
      if (!ran) {
        break;
      }
      processed += 1;
    }
    return processed;
  }

  async processNext() {
    const job = await this.jobs.claimNext(DIRECT_TYPES);
    if (!job) {
      return false;
    }

    const startedAt = Date.now();
    try {
      const result = await this.director.processJob(job);
      await this.jobs.complete(job.id, {
        creativePlanId: result.id,
        version: result.version,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Director composition failed.";
      const retryable = !isAppError(error);
      const failed = await this.jobs.fail(job.id, {
        error: message,
        retry: retryable,
      });
      logger.error("director.failed", {
        jobId: job.id,
        projectId: job.projectId,
        retryable,
        status: failed.status,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return true;
    }
  }
}
