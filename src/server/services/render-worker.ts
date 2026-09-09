import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { JobStatus, JobType } from "@/server/domain/status";
import type { JobQueuePort } from "@/server/ports/jobs";
import { RenderService } from "@/server/services/render";

const RENDER_TYPES = [JobType.RENDER];

export class RenderWorker {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly render: RenderService,
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
    const job = await this.jobs.claimNext(RENDER_TYPES);
    if (!job) {
      return false;
    }

    const startedAt = Date.now();
    try {
      const result = await this.render.processJob(job);
      const current = await this.jobs.get(job.id);
      if (result.cancelled || current?.status === JobStatus.CANCELLED) {
        logger.info("render.cancelled", {
          jobId: job.id,
          projectId: job.projectId,
          renderJobId: result.renderJobId,
          durationMs: Date.now() - startedAt,
        });
        return true;
      }
      await this.jobs.complete(job.id, { renderJobId: result.renderJobId });
      return true;
    } catch (error) {
      const current = await this.jobs.get(job.id);
      if (current?.status === JobStatus.CANCELLED) {
        return true;
      }
      const message = error instanceof Error ? error.message : "Render failed.";
      const retryable = !isAppError(error);
      const failed = await this.jobs.fail(job.id, {
        error: message,
        retry: retryable,
      });
      if (failed.status === JobStatus.FAILED) {
        await this.render.markFailed(job.id, message);
      }
      logger.error("render.failed", {
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
