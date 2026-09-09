import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { TimelineExecutionAttribution } from "@/server/adapters/timeline/attribution";
import { prisma } from "@/server/db";
import {
  JobStatus,
  JobType,
  StoryStructureStatus,
  TimelineStatus,
} from "@/server/domain/status";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import type { JobQueuePort, JobRecord } from "@/server/ports/jobs";
import { AttributionService } from "@/server/services/attribution";
import { ProjectService } from "@/server/services/projects";
import {
  extractPriorTimeline,
  fingerprintStoredStory,
  parseStoryDocumentJson,
  TimelineContractService,
  type ReadyStoryStructureSource,
} from "@/server/services/timeline-contract";
import { fingerprintTimelineComposerInput } from "@/server/timeline/fingerprint";
import type { TimelineDocument } from "@/server/timeline/schema";

export type TimelineView = {
  id: string;
  projectId: string;
  version: number;
  status: string;
  document: TimelineDocument;
  jobId: string | null;
  inputFingerprint: string;
  storyStructureId: string;
  storyStructureVersion: number;
  storyFingerprint: string | null;
  creativePlanId: string | null;
  creativePlanVersion: number | null;
  providerKey: string;
  capability: string;
  modelId: string | null;
  modelVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimelineAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canCompose: boolean;
};

export type TimelineJobStatusView = {
  jobId: string;
  status: string;
  error: string | null;
  timelineId: string | null;
  version: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ResolvedTimelineRuntime = {
  adapter: TimelineComposerPort;
  attribution: TimelineExecutionAttribution;
};

type TimelineJobPayload = {
  projectId: string;
  requestedBy: string;
};

type TimelineClipPayload = {
  clipId: string;
  trackKey: string;
  sourceKind?: string;
  sourceInMs?: number;
  sourceOutMs?: number;
  transitionFromPrevious?: string;
  captionText?: string;
  notes?: string;
  storySceneId?: string;
  mediaRole?: string;
};

/**
 * M2 timeline composition. Assembles input, composes via TimelineComposerPort,
 * validates, persists a versioned Timeline + TimelineClip rows, and records attribution.
 * Does not write RenderJob, FinishedMovie, Publication, or GeneratedAsset.
 *
 * Provenance is captured from adapter/runtime metadata outside the
 * TimelineComposerPort.composeTimeline return type (TimelineDocument only).
 */
export class TimelineService {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly contract: TimelineContractService,
    private readonly projects: ProjectService,
    private readonly attribution: AttributionService,
    private readonly resolveComposer: () => ResolvedTimelineRuntime | null,
    private readonly availability: () => TimelineAvailability,
  ) {}

  getAvailability(): TimelineAvailability {
    return this.availability();
  }

  /**
   * Production timeline only marks productionAvailable.
   * Local deterministic never masquerades as production.
   */
  requireComposeCapability() {
    const avail = this.availability();
    if (!avail.canCompose) {
      throw AppError.providerNotConfigured("TimelineComposerPort");
    }
    if (!avail.productionAvailable && avail.localDevAvailable) {
      return { mode: "local" as const };
    }
    if (!avail.productionAvailable) {
      throw AppError.providerNotConfigured("TimelineComposerPort");
    }
    return { mode: "production" as const };
  }

  /** Explicit Rebuild cut (D9). Same compose path — never auto-fired on generation success. */
  async requestRebuild(userId: string, projectId: string) {
    return this.requestCompose(userId, projectId);
  }

  async requestCompose(userId: string, projectId: string) {
    await this.projects.getForUser(userId, projectId);
    this.requireComposeCapability();
    await this.requireReadyStory(projectId);

    const job = await this.jobs.enqueue({
      type: JobType.AI_TIMELINE,
      projectId,
      payload: {
        projectId,
        requestedBy: userId,
      } satisfies TimelineJobPayload,
    });

    logger.info("timeline.queued", { userId, projectId, jobId: job.id });
    return { jobId: job.id, status: JobStatus.PENDING };
  }

  async getJobStatus(
    userId: string,
    projectId: string,
    jobId: string,
  ): Promise<TimelineJobStatusView> {
    await this.projects.getForUser(userId, projectId);
    const job = await this.jobs.get(jobId);
    if (!job || job.projectId !== projectId || job.type !== JobType.AI_TIMELINE) {
      throw AppError.notFound("That cut job was not found.");
    }

    const row = await prisma.timeline.findFirst({
      where: { projectId, jobId },
      orderBy: { version: "desc" },
    });

    return {
      jobId: job.id,
      status: job.status,
      error: job.error,
      timelineId: row?.id ?? null,
      version: row?.version ?? null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  async getLatestReady(userId: string, projectId: string): Promise<TimelineView | null> {
    await this.projects.getForUser(userId, projectId);
    const row = await prisma.timeline.findFirst({
      where: { projectId, status: TimelineStatus.READY },
      orderBy: { version: "desc" },
    });
    return row ? this.toView(row) : null;
  }

  async listTimelines(userId: string, projectId: string): Promise<TimelineView[]> {
    await this.projects.getForUser(userId, projectId);
    const rows = await prisma.timeline.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async processJob(job: JobRecord): Promise<TimelineView> {
    const payload = job.payload as TimelineJobPayload | null;
    if (!payload?.projectId || !payload.requestedBy) {
      throw AppError.jobFailed("Timeline job is missing project context.");
    }

    const resolved = this.resolveComposer();
    if (!resolved) {
      throw AppError.providerNotConfigured("TimelineComposerPort");
    }

    const userId = payload.requestedBy;
    const projectId = payload.projectId;
    await this.projects.getForUser(userId, projectId);

    const startedAt = Date.now();
    logger.info("timeline.started", { projectId, jobId: job.id });

    const source = await this.requireReadyStory(projectId);
    const priorReady = await prisma.timeline.findFirst({
      where: { projectId, status: TimelineStatus.READY },
      orderBy: { version: "desc" },
    });
    const priorTimeline = extractPriorTimeline(priorReady?.payload);
    const input = await this.contract.assembleInput(userId, projectId, source, priorTimeline);
    const inputFingerprint = fingerprintTimelineComposerInput(input);

    const rawDocument = await resolved.adapter.composeTimeline(input);
    const document = this.contract.validateDocument(
      source,
      input.mediaInventory,
      rawDocument,
      input.generatedInventory ?? [],
    );
    const { attribution } = resolved;

    const latestVersion = await prisma.timeline.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    const row = await prisma.$transaction(async (tx) => {
      if (priorReady) {
        await tx.timeline.updateMany({
          where: {
            projectId,
            status: TimelineStatus.READY,
          },
          data: { status: TimelineStatus.SUPERSEDED },
        });
      }

      const created = await tx.timeline.create({
        data: {
          projectId,
          version: nextVersion,
          status: TimelineStatus.READY,
          payload: document as Prisma.InputJsonValue,
          jobId: job.id,
          inputFingerprint,
          storyStructureId: source.id,
          storyStructureVersion: source.version,
          storyFingerprint: source.storyFingerprint,
          creativePlanId: source.creativePlanId,
          creativePlanVersion: source.creativePlanVersion,
          providerKey: attribution.providerKey,
          capability: attribution.capability,
          modelId: attribution.modelId,
          modelVersion: attribution.modelVersion,
        },
      });

      if (document.clips.length > 0) {
        await tx.timelineClip.createMany({
          data: document.clips.map((clip, index) => ({
            timelineId: created.id,
            sourceKind: clip.sourceKind ?? "MEDIA_ASSET",
            assetId: clip.sourceKind === "GENERATED_ASSET" ? null : clip.assetId ?? null,
            generatedAssetId:
              clip.sourceKind === "GENERATED_ASSET" ? clip.generatedAssetId ?? null : null,
            sortOrder: index,
            startMs: clip.timelineStartMs,
            endMs: clip.timelineEndMs,
            payload: clipPayload(clip) as Prisma.InputJsonValue,
          })),
        });
      }

      return created;
    });

    await this.attribution.record({
      projectId,
      jobId: job.id,
      providerKey: attribution.providerKey,
      capability: attribution.capability,
      modelId: attribution.modelId,
      modelVersion: attribution.modelVersion,
    });

    logger.info("timeline.completed", {
      projectId,
      jobId: job.id,
      timelineId: row.id,
      version: row.version,
      storyStructureId: source.id,
      storyStructureVersion: source.version,
      providerKey: attribution.providerKey,
      inputFingerprint,
      clipCount: document.clips.length,
      durationMs: Date.now() - startedAt,
    });

    return this.toView(row);
  }

  toView(row: {
    id: string;
    projectId: string;
    version: number;
    status: string;
    payload: Prisma.JsonValue | null;
    jobId: string | null;
    inputFingerprint: string;
    storyStructureId: string;
    storyStructureVersion: number;
    storyFingerprint: string | null;
    creativePlanId: string | null;
    creativePlanVersion: number | null;
    providerKey: string;
    capability: string;
    modelId: string | null;
    modelVersion: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): TimelineView {
    return {
      id: row.id,
      projectId: row.projectId,
      version: row.version,
      status: row.status,
      document: row.payload as TimelineDocument,
      jobId: row.jobId,
      inputFingerprint: row.inputFingerprint,
      storyStructureId: row.storyStructureId,
      storyStructureVersion: row.storyStructureVersion,
      storyFingerprint: row.storyFingerprint,
      creativePlanId: row.creativePlanId,
      creativePlanVersion: row.creativePlanVersion,
      providerKey: row.providerKey,
      capability: row.capability,
      modelId: row.modelId,
      modelVersion: row.modelVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async requireReadyStory(projectId: string): Promise<ReadyStoryStructureSource> {
    const row = await prisma.storyStructure.findFirst({
      where: { projectId, status: StoryStructureStatus.READY },
      orderBy: { version: "desc" },
    });
    if (!row || !row.payload) {
      throw AppError.timelineStoryRequired();
    }
    return {
      id: row.id,
      version: row.version,
      document: parseStoryDocumentJson(row.payload),
      storyFingerprint: fingerprintStoredStory(row.payload),
      creativePlanId: row.creativePlanId,
      creativePlanVersion: row.creativePlanVersion,
    };
  }
}

function clipPayload(clip: TimelineDocument["clips"][number]): TimelineClipPayload {
  return {
    clipId: clip.id,
    trackKey: clip.trackKey,
    sourceKind: clip.sourceKind ?? "MEDIA_ASSET",
    sourceInMs: clip.sourceInMs,
    sourceOutMs: clip.sourceOutMs,
    transitionFromPrevious: clip.transitionFromPrevious,
    captionText: clip.captionText,
    notes: clip.notes,
    storySceneId: clip.storySceneId,
    mediaRole: clip.mediaRole,
  };
}
