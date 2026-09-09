import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { JobStatus, JobType } from "@/server/domain/status";
import type { JobQueuePort } from "@/server/ports/jobs";
import { MovieService } from "@/server/services/movie";

const KEEP_TYPES = [JobType.LIBRARY_KEEP];

export class MovieWorker {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly movies: MovieService,
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
    const job = await this.jobs.claimNext(KEEP_TYPES);
    if (!job) {
      return false;
    }

    const startedAt = Date.now();
    try {
      const result = await this.movies.processJob(job);
      const current = await this.jobs.get(job.id);
      if (current?.status === JobStatus.CANCELLED) {
        logger.info("movie.keep_cancelled", {
          jobId: job.id,
          projectId: job.projectId,
          movieId: result.movieId,
          durationMs: Date.now() - startedAt,
        });
        return true;
      }
      await this.jobs.complete(job.id, { movieId: result.movieId });
      return true;
    } catch (error) {
      const current = await this.jobs.get(job.id);
      if (current?.status === JobStatus.CANCELLED) {
        return true;
      }
      const message = error instanceof Error ? error.message : "Keep failed.";
      const retryable = !isAppError(error);
      const failed = await this.jobs.fail(job.id, {
        error: message,
        retry: retryable,
      });
      if (failed.status === JobStatus.FAILED) {
        await this.movies.markFailed(job.id, message);
      }
      logger.error("movie.keep_job_failed", {
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
