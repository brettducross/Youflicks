import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { JobStatus, JobType } from "@/server/domain/status";
import type { JobQueuePort } from "@/server/ports/jobs";
import { AssetService } from "@/server/services/asset";

const ASSET_TYPES = [JobType.AI_ASSET];

export class AssetWorker {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly assets: AssetService,
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
    const job = await this.jobs.claimNext(ASSET_TYPES);
    if (!job) {
      return false;
    }

    const startedAt = Date.now();
    try {
      const result = await this.assets.processJob(job);
      const current = await this.jobs.get(job.id);
      if (result.cancelled || current?.status === JobStatus.CANCELLED) {
        logger.info("asset.cancelled", {
          jobId: job.id,
          projectId: job.projectId,
          assetIds: result.assetIds,
          durationMs: Date.now() - startedAt,
        });
        return true;
      }
      await this.jobs.complete(job.id, { assetIds: result.assetIds });
      return true;
    } catch (error) {
      const current = await this.jobs.get(job.id);
      if (current?.status === JobStatus.CANCELLED) {
        return true;
      }
      const message = error instanceof Error ? error.message : "Asset generation failed.";
      const retryable = !isAppError(error);
      const failed = await this.jobs.fail(job.id, {
        error: message,
        retry: retryable,
      });
      logger.error("asset.failed", {
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
