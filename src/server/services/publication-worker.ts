import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { JobStatus, JobType } from "@/server/domain/status";
import type { JobQueuePort } from "@/server/ports/jobs";
import { PublicationService } from "@/server/services/publication";

const PUBLISH_TYPES = [JobType.PUBLISH];

export class PublicationWorker {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly publications: PublicationService,
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
    const job = await this.jobs.claimNext(PUBLISH_TYPES);
    if (!job) {
      return false;
    }

    const startedAt = Date.now();
    try {
      const result = await this.publications.processJob(job);
      const current = await this.jobs.get(job.id);
      if (current?.status === JobStatus.CANCELLED) {
        logger.info("publication.cancelled", {
          jobId: job.id,
          projectId: job.projectId,
          publicationId: result.publicationId,
          durationMs: Date.now() - startedAt,
        });
        return true;
      }
      await this.jobs.complete(job.id, {
        publicationId: result.publicationId,
        shareUrl: result.shareUrl,
        token: result.token,
      });
      return true;
    } catch (error) {
      const current = await this.jobs.get(job.id);
      if (current?.status === JobStatus.CANCELLED) {
        return true;
      }
      const message = error instanceof Error ? error.message : "Publish failed.";
      const retryable = !isAppError(error);
      const failed = await this.jobs.fail(job.id, {
        error: message,
        retry: retryable,
      });
      if (failed.status === JobStatus.FAILED) {
        await this.publications.markFailed(job.id, message);
      }
      logger.error("publication.job_failed", {
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
