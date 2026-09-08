import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { JobType } from "@/server/domain/status";
import type { JobQueuePort } from "@/server/ports/jobs";
import { StoryService } from "@/server/services/story";

const STORY_TYPES = [JobType.AI_STORY];

export class StoryWorker {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly story: StoryService,
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
    const job = await this.jobs.claimNext(STORY_TYPES);
    if (!job) {
      return false;
    }

    const startedAt = Date.now();
    try {
      const result = await this.story.processJob(job);
      await this.jobs.complete(job.id, {
        storyStructureId: result.id,
        version: result.version,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Story composition failed.";
      const retryable = !isAppError(error);
      const failed = await this.jobs.fail(job.id, {
        error: message,
        retry: retryable,
      });
      logger.error("story.failed", {
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
