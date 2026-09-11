import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { StoryExecutionAttribution } from "@/server/adapters/story/attribution";
import { prisma } from "@/server/db";
import {
  CreativePlanStatus,
  JobStatus,
  JobType,
  StoryStructureStatus,
} from "@/server/domain/status";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { JobQueuePort, JobRecord } from "@/server/ports/jobs";
import { AttributionService } from "@/server/services/attribution";
import { EntitlementService } from "@/server/services/entitlement";
import { ProjectService } from "@/server/services/projects";
import {
  extractPriorStory,
  fingerprintStoredPlan,
  parseCreativePlanJson,
  StoryContractService,
  type ReadyCreativePlanSource,
} from "@/server/services/story-contract";
import { fingerprintStoryComposerInput } from "@/server/story/fingerprint";
import type { StoryDocument } from "@/server/story/schema";

export type StoryStructureView = {
  id: string;
  projectId: string;
  version: number;
  status: string;
  document: StoryDocument;
  jobId: string | null;
  inputFingerprint: string;
  creativePlanId: string;
  creativePlanVersion: number;
  planFingerprint: string | null;
  providerKey: string;
  capability: string;
  modelId: string | null;
  modelVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoryAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canCompose: boolean;
};

export type StoryJobStatusView = {
  jobId: string;
  status: string;
  error: string | null;
  storyStructureId: string | null;
  version: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ResolvedStoryRuntime = {
  adapter: StoryComposerPort;
  attribution: StoryExecutionAttribution;
};

type StoryJobPayload = {
  projectId: string;
  requestedBy: string;
};

/**
 * M1 story composition. Assembles input, composes via StoryComposerPort,
 * validates, persists a versioned StoryStructure, and records attribution.
 * Does not write Timeline, TimelineClip, RenderJob, FinishedMovie, or Publication.
 *
 * Provenance is captured from adapter/runtime metadata outside the
 * StoryComposerPort.composeStory return type (StoryDocument only).
 */
export class StoryService {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly contract: StoryContractService,
    private readonly projects: ProjectService,
    private readonly attribution: AttributionService,
    private readonly resolveComposer: () => ResolvedStoryRuntime | null,
    private readonly availability: () => StoryAvailability,
    private readonly entitlements: EntitlementService = new EntitlementService(),
  ) {}

  getAvailability(): StoryAvailability {
    return this.availability();
  }

  /**
   * Production story only marks productionAvailable.
   * Local deterministic never masquerades as production.
   */
  requireComposeCapability() {
    const avail = this.availability();
    if (!avail.canCompose) {
      throw AppError.providerNotConfigured("StoryComposerPort");
    }
    if (!avail.productionAvailable && avail.localDevAvailable) {
      return { mode: "local" as const };
    }
    if (!avail.productionAvailable) {
      throw AppError.providerNotConfigured("StoryComposerPort");
    }
    return { mode: "production" as const };
  }

  async requestCompose(userId: string, projectId: string) {
    await this.projects.getForUser(userId, projectId);
    this.requireComposeCapability();
    await this.entitlements.requirePaidEnqueue(userId);
    await this.requireReadyPlan(projectId);

    const job = await this.jobs.enqueue({
      type: JobType.AI_STORY,
      projectId,
      payload: {
        projectId,
        requestedBy: userId,
      } satisfies StoryJobPayload,
    });

    logger.info("story.queued", { userId, projectId, jobId: job.id });
    return { jobId: job.id, status: JobStatus.PENDING };
  }

  async getJobStatus(
    userId: string,
    projectId: string,
    jobId: string,
  ): Promise<StoryJobStatusView> {
    await this.projects.getForUser(userId, projectId);
    const job = await this.jobs.get(jobId);
    if (!job || job.projectId !== projectId || job.type !== JobType.AI_STORY) {
      throw AppError.notFound("That story job was not found.");
    }

    const row = await prisma.storyStructure.findFirst({
      where: { projectId, jobId },
      orderBy: { version: "desc" },
    });

    return {
      jobId: job.id,
      status: job.status,
      error: job.error,
      storyStructureId: row?.id ?? null,
      version: row?.version ?? null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  async getLatestReady(userId: string, projectId: string): Promise<StoryStructureView | null> {
    await this.projects.getForUser(userId, projectId);
    const row = await prisma.storyStructure.findFirst({
      where: { projectId, status: StoryStructureStatus.READY },
      orderBy: { version: "desc" },
    });
    return row ? this.toView(row) : null;
  }

  async listStories(userId: string, projectId: string): Promise<StoryStructureView[]> {
    await this.projects.getForUser(userId, projectId);
    const rows = await prisma.storyStructure.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async processJob(job: JobRecord): Promise<StoryStructureView> {
    const payload = job.payload as StoryJobPayload | null;
    if (!payload?.projectId || !payload.requestedBy) {
      throw AppError.jobFailed("Story job is missing project context.");
    }

    const resolved = this.resolveComposer();
    if (!resolved) {
      throw AppError.providerNotConfigured("StoryComposerPort");
    }

    const userId = payload.requestedBy;
    const projectId = payload.projectId;
    await this.projects.getForUser(userId, projectId);

    const startedAt = Date.now();
    logger.info("story.started", { projectId, jobId: job.id });

    const source = await this.requireReadyPlan(projectId);
    const priorReady = await prisma.storyStructure.findFirst({
      where: { projectId, status: StoryStructureStatus.READY },
      orderBy: { version: "desc" },
    });
    const priorStory = extractPriorStory(priorReady?.payload);
    const input = await this.contract.assembleInput(userId, projectId, source, priorStory);
    const inputFingerprint = fingerprintStoryComposerInput(input);

    const rawDocument = await resolved.adapter.composeStory(input);
    const document = this.contract.validateDocument(source, rawDocument);
    const { attribution } = resolved;

    const latestVersion = await prisma.storyStructure.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    const row = await prisma.$transaction(async (tx) => {
      if (priorReady) {
        await tx.storyStructure.updateMany({
          where: {
            projectId,
            status: StoryStructureStatus.READY,
          },
          data: { status: StoryStructureStatus.SUPERSEDED },
        });
      }

      return tx.storyStructure.create({
        data: {
          projectId,
          version: nextVersion,
          status: StoryStructureStatus.READY,
          payload: document as Prisma.InputJsonValue,
          jobId: job.id,
          inputFingerprint,
          creativePlanId: source.id,
          creativePlanVersion: source.version,
          planFingerprint: source.planFingerprint,
          providerKey: attribution.providerKey,
          capability: attribution.capability,
          modelId: attribution.modelId,
          modelVersion: attribution.modelVersion,
        },
      });
    });

    await this.attribution.record({
      projectId,
      jobId: job.id,
      providerKey: attribution.providerKey,
      capability: attribution.capability,
      modelId: attribution.modelId,
      modelVersion: attribution.modelVersion,
    });

    logger.info("story.completed", {
      projectId,
      jobId: job.id,
      storyStructureId: row.id,
      version: row.version,
      creativePlanId: source.id,
      creativePlanVersion: source.version,
      providerKey: attribution.providerKey,
      inputFingerprint,
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
    creativePlanId: string;
    creativePlanVersion: number;
    planFingerprint: string | null;
    providerKey: string;
    capability: string;
    modelId: string | null;
    modelVersion: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): StoryStructureView {
    return {
      id: row.id,
      projectId: row.projectId,
      version: row.version,
      status: row.status,
      document: row.payload as StoryDocument,
      jobId: row.jobId,
      inputFingerprint: row.inputFingerprint,
      creativePlanId: row.creativePlanId,
      creativePlanVersion: row.creativePlanVersion,
      planFingerprint: row.planFingerprint,
      providerKey: row.providerKey,
      capability: row.capability,
      modelId: row.modelId,
      modelVersion: row.modelVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async requireReadyPlan(projectId: string): Promise<ReadyCreativePlanSource> {
    const row = await prisma.creativePlan.findFirst({
      where: { projectId, status: CreativePlanStatus.READY },
      orderBy: { version: "desc" },
    });
    if (!row) {
      throw AppError.storyPlanRequired();
    }
    return {
      id: row.id,
      version: row.version,
      plan: parseCreativePlanJson(row.plan),
      planFingerprint: fingerprintStoredPlan(row.plan),
    };
  }
}
