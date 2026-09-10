import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { DirectorExecutionAttribution } from "@/server/adapters/director/attribution";
import { prisma } from "@/server/db";
import { fingerprintDirectorInput } from "@/server/director/fingerprint";
import type { CreativePlan, DirectorDecision } from "@/server/director/schema";
import {
  CreativePlanStatus,
  JobStatus,
  JobType,
  ProjectStatus,
} from "@/server/domain/status";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { JobQueuePort, JobRecord } from "@/server/ports/jobs";
import { AttributionService } from "@/server/services/attribution";
import type { UsageMeterPort } from "@/server/ports/usage-meter";
import { EntitlementService } from "@/server/services/entitlement";
import { DirectorContractService } from "@/server/services/director-contract";
import { ProjectService } from "@/server/services/projects";
import { UsageMeterService } from "@/server/services/usage-meter";
import { UsageKind, UsageOutcome } from "@/server/usage/types";

export type CreativePlanView = {
  id: string;
  projectId: string;
  version: number;
  status: string;
  plan: CreativePlan;
  jobId: string | null;
  inputFingerprint: string;
  providerKey: string;
  capability: string;
  modelId: string | null;
  modelVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DirectorAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canCompose: boolean;
};

export type DirectorJobStatusView = {
  jobId: string;
  status: string;
  error: string | null;
  creativePlanId: string | null;
  version: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ResolvedDirectorRuntime = {
  adapter: AiDirectorPort;
  attribution: DirectorExecutionAttribution;
};

type DirectJobPayload = {
  projectId: string;
  requestedBy: string;
};

/**
 * Phase 2F Director execution. Assembles input, composes via AiDirectorPort,
 * validates, persists a versioned CreativePlan, and records attribution.
 * Does not write StoryStructure, Timeline, or RenderJob.
 *
 * Provenance is captured from adapter/runtime metadata outside the frozen
 * AiDirectorPort.composePlan return type (CreativePlan only).
 */
export class DirectorService {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly contract: DirectorContractService,
    private readonly projects: ProjectService,
    private readonly attribution: AttributionService,
    private readonly resolveDirector: () => ResolvedDirectorRuntime | null,
    private readonly availability: () => DirectorAvailability,
    private readonly entitlements: EntitlementService,
    private readonly usage: UsageMeterPort = new UsageMeterService(),
  ) {}

  getAvailability(): DirectorAvailability {
    return this.availability();
  }

  /**
   * Production Director only marks productionAvailable.
   * Local deterministic never masquerades as production.
   */
  requireComposeCapability() {
    const avail = this.availability();
    if (!avail.canCompose) {
      throw AppError.providerNotConfigured("AiDirectorPort");
    }
    if (!avail.productionAvailable && avail.localDevAvailable) {
      // Explicit local opt-in only — still not production.
      return { mode: "local" as const };
    }
    if (!avail.productionAvailable) {
      throw AppError.providerNotConfigured("AiDirectorPort");
    }
    return { mode: "production" as const };
  }

  async requestCompose(userId: string, projectId: string) {
    await this.projects.getForUser(userId, projectId);
    this.requireComposeCapability();
    const authorized = await this.entitlements.requireGeneration(userId, { projectId });
    logger.info("director.generation_constraints_received", {
      userId,
      projectId,
      maxOutputDurationMs: authorized.constraints.maxOutputDurationMs,
      watermarkRequired: authorized.constraints.watermarkRequired,
      adsEnabled: authorized.constraints.adsEnabled,
    });

    const job = await this.jobs.enqueue({
      type: JobType.AI_DIRECT,
      projectId,
      payload: {
        projectId,
        requestedBy: userId,
      } satisfies DirectJobPayload,
    });

    await prisma.project.updateMany({
      where: {
        id: projectId,
        status: {
          in: [
            ProjectStatus.DRAFT,
            ProjectStatus.INGESTING,
            ProjectStatus.ANALYZING,
          ],
        },
      },
      data: { status: ProjectStatus.DIRECTING },
    });

    logger.info("director.queued", { userId, projectId, jobId: job.id });
    return { jobId: job.id, status: JobStatus.PENDING };
  }

  async getJobStatus(
    userId: string,
    projectId: string,
    jobId: string,
  ): Promise<DirectorJobStatusView> {
    await this.projects.getForUser(userId, projectId);
    const job = await this.jobs.get(jobId);
    if (!job || job.projectId !== projectId || job.type !== JobType.AI_DIRECT) {
      throw AppError.notFound("That Director job was not found.");
    }

    const plan = await prisma.creativePlan.findFirst({
      where: { projectId, jobId },
      orderBy: { version: "desc" },
    });

    return {
      jobId: job.id,
      status: job.status,
      error: job.error,
      creativePlanId: plan?.id ?? null,
      version: plan?.version ?? null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  async getLatestReady(userId: string, projectId: string): Promise<CreativePlanView | null> {
    await this.projects.getForUser(userId, projectId);
    const row = await prisma.creativePlan.findFirst({
      where: { projectId, status: CreativePlanStatus.READY },
      orderBy: { version: "desc" },
    });
    return row ? this.toView(row) : null;
  }

  async listPlans(userId: string, projectId: string): Promise<CreativePlanView[]> {
    await this.projects.getForUser(userId, projectId);
    const rows = await prisma.creativePlan.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async getPlan(
    userId: string,
    projectId: string,
    planId: string,
  ): Promise<CreativePlanView> {
    await this.projects.getForUser(userId, projectId);
    const row = await prisma.creativePlan.findFirst({
      where: { id: planId, projectId },
    });
    if (!row) {
      throw AppError.notFound("That creative plan was not found.");
    }
    return this.toView(row);
  }

  async processJob(job: JobRecord): Promise<CreativePlanView> {
    const payload = job.payload as DirectJobPayload | null;
    if (!payload?.projectId || !payload.requestedBy) {
      throw AppError.jobFailed("Director job is missing project context.");
    }

    const resolved = this.resolveDirector();
    if (!resolved) {
      throw AppError.providerNotConfigured("AiDirectorPort");
    }

    const userId = payload.requestedBy;
    const projectId = payload.projectId;
    await this.projects.getForUser(userId, projectId);

    const startedAt = Date.now();
    logger.info("director.started", { projectId, jobId: job.id });

    const assembled = await this.contract.assembleInput(userId, projectId);
    const priorReady = await prisma.creativePlan.findFirst({
      where: { projectId, status: CreativePlanStatus.READY },
      orderBy: { version: "desc" },
    });
    const priorDecisions = extractPriorDecisions(priorReady?.plan);
    const input = { ...assembled, priorDecisions };

    const inputFingerprint = fingerprintDirectorInput(input);
    const { attribution } = resolved;
    let rawPlan;
    try {
      rawPlan = await resolved.adapter.composePlan(input);
    } catch (error) {
      await this.usage.recordJobUsage({
        userId,
        projectId,
        jobId: job.id,
        kind: UsageKind.MOVIE_GENERATION,
        quantity: 1,
        outcome: UsageOutcome.FAILED,
        providerKey: attribution.providerKey,
        capability: attribution.capability,
      });
      throw error;
    }
    await this.usage.recordJobUsage({
      userId,
      projectId,
      jobId: job.id,
      kind: UsageKind.MOVIE_GENERATION,
      quantity: 1,
      outcome: UsageOutcome.SUCCEEDED,
      providerKey: attribution.providerKey,
      capability: attribution.capability,
    });
    const plan = this.contract.validatePlan(input, rawPlan);

    const latestVersion = await prisma.creativePlan.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    const row = await prisma.$transaction(async (tx) => {
      if (priorReady) {
        await tx.creativePlan.updateMany({
          where: {
            projectId,
            status: CreativePlanStatus.READY,
          },
          data: { status: CreativePlanStatus.SUPERSEDED },
        });
      }

      return tx.creativePlan.create({
        data: {
          projectId,
          version: nextVersion,
          status: CreativePlanStatus.READY,
          plan: plan as Prisma.InputJsonValue,
          jobId: job.id,
          inputFingerprint,
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

    await prisma.project.updateMany({
      where: { id: projectId, status: ProjectStatus.DIRECTING },
      data: { status: ProjectStatus.DIRECTING },
    });

    logger.info("director.completed", {
      projectId,
      jobId: job.id,
      creativePlanId: row.id,
      version: row.version,
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
    plan: Prisma.JsonValue;
    jobId: string | null;
    inputFingerprint: string;
    providerKey: string;
    capability: string;
    modelId: string | null;
    modelVersion: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CreativePlanView {
    return {
      id: row.id,
      projectId: row.projectId,
      version: row.version,
      status: row.status,
      plan: row.plan as CreativePlan,
      jobId: row.jobId,
      inputFingerprint: row.inputFingerprint,
      providerKey: row.providerKey,
      capability: row.capability,
      modelId: row.modelId,
      modelVersion: row.modelVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function extractPriorDecisions(planJson: Prisma.JsonValue | null | undefined): DirectorDecision[] {
  if (!planJson || typeof planJson !== "object" || Array.isArray(planJson)) {
    return [];
  }
  const decisions = (planJson as { decisions?: unknown }).decisions;
  if (!Array.isArray(decisions)) {
    return [];
  }
  return decisions.filter(
    (item): item is DirectorDecision =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as DirectorDecision).kind === "string" &&
          typeof (item as DirectorDecision).summary === "string",
      ),
  );
}
