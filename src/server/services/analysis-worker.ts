import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { JobType } from "@/server/domain/status";
import type { JobQueuePort } from "@/server/ports/jobs";
import { AnalysisService } from "@/server/services/analysis";

const ANALYZE_TYPES = [JobType.MEDIA_ANALYZE];

export class AnalysisWorker {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly analysis: AnalysisService,
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
    const job = await this.jobs.claimNext(ANALYZE_TYPES);
    if (!job) {
      return false;
    }

    const payload = job.payload as { assetId?: string } | null;
    const startedAt = Date.now();
    try {
      const result = await this.analysis.processJob(job);
      await this.jobs.complete(job.id, { analysisId: result.id });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed.";
      const retryable = !isAppError(error);
      if (payload?.assetId && !retryable) {
        await this.analysis.markAssetFailed(payload.assetId, message).catch(() => undefined);
      }
      const failed = await this.jobs.fail(job.id, {
        error: message,
        retry: retryable,
      });
      if (payload?.assetId && failed.status === "FAILED") {
        await this.analysis.markAssetFailed(payload.assetId, message).catch(() => undefined);
      }
      logger.error("analysis.failed", {
        jobId: job.id,
        assetId: payload?.assetId,
        retryable,
        status: failed.status,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return true;
    }
  }
}
