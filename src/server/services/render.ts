import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { RenderExecutionAttribution } from "@/server/adapters/renderer/attribution";
import { prisma } from "@/server/db";
import { JobStatus, JobType, RenderJobStatus } from "@/server/domain/status";
import { RenderCapability } from "@/server/ports/capabilities";
import type { JobQueuePort, JobRecord } from "@/server/ports/jobs";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoragePort } from "@/server/ports/storage";
import { fingerprintRenderRequest } from "@/server/render/fingerprint";
import type { RenderAvailability } from "@/server/render/provider-config";
import type { RenderJobPayloadDocument, RenderOutputProfile } from "@/server/render/schema";
import type { UsageMeterPort } from "@/server/ports/usage-meter";
import { AttributionService } from "@/server/services/attribution";
import { ProjectService } from "@/server/services/projects";
import { RenderContractService } from "@/server/services/render-contract";
import { UsageMeterService } from "@/server/services/usage-meter";
import { UsageKind, UsageOutcome } from "@/server/usage/types";

export type RenderView = {
  id: string;
  projectId: string;
  status: string;
  timelineId: string;
  timelineVersion: number;
  jobId: string | null;
  inputFingerprint: string;
  outputProfile: RenderOutputProfile | null;
  mimeType: string | null;
  durationMs: number | null;
  byteSize: number | null;
  checksum: string | null;
  progress: { percent?: number; stage?: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type RenderJobStatusView = {
  jobId: string;
  renderJobId: string | null;
  status: string;
  renderStatus: string | null;
  error: string | null;
  inputFingerprint: string | null;
  progress: { percent?: number; stage?: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ResolvedRenderRuntime = {
  adapter: RendererPort;
  attribution: RenderExecutionAttribution;
};

type RenderQueuePayload = {
  projectId: string;
  requestedBy: string;
  inputFingerprint: string;
  renderJobId: string;
  timelineId: string;
  timelineVersion: number;
  outputProfile: RenderOutputProfile;
};

/**
 * M4 render. Assembles a YouFlicks-owned RenderManifest from a READY Timeline,
 * enqueues RENDER, calls RendererPort, and persists RenderJob success.
 * Does not write FinishedMovie, Publication, or mutate Timeline/Story/Plan.
 * Attribution is recorded outside RendererPort.render.
 */
export class RenderService {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly storage: StoragePort,
    private readonly contract: RenderContractService,
    private readonly projects: ProjectService,
    private readonly attribution: AttributionService,
    private readonly resolveRenderer: () => ResolvedRenderRuntime | null,
    private readonly availability: () => RenderAvailability,
    private readonly usage: UsageMeterPort = new UsageMeterService(),
  ) {}

  getAvailability(): RenderAvailability {
    return this.availability();
  }

  /**
   * Production render only marks productionAvailable.
   * Local deterministic never masquerades as production.
   */
  requireRenderCapability() {
    const avail = this.availability();
    if (!avail.canRender) {
      throw AppError.providerNotConfigured("RendererPort");
    }
    if (!avail.productionAvailable && avail.localDevAvailable) {
      return { mode: "local" as const };
    }
    if (!avail.productionAvailable) {
      throw AppError.providerNotConfigured("RendererPort");
    }
    return { mode: "production" as const };
  }

  async requestRender(
    userId: string,
    projectId: string,
    body: { outputProfile?: string } = {},
  ) {
    await this.projects.getForUser(userId, projectId);
    this.requireRenderCapability();
    const outputProfile = this.contract.parseOutputProfile(body.outputProfile);
    const { timeline, manifest } = await this.contract.assembleManifest(
      userId,
      projectId,
      outputProfile,
    );
    const inputFingerprint = fingerprintRenderRequest({
      projectId,
      timelineId: timeline.id,
      timelineVersion: timeline.version,
      outputProfile,
      manifest,
    });

    const open = await this.findOpenJob(projectId, inputFingerprint);
    if (open) {
      logger.info("render.enqueue_idempotent", {
        userId,
        projectId,
        jobId: open.id,
        inputFingerprint,
      });
      return { jobId: open.id, status: open.status, inputFingerprint };
    }

    const job = await this.jobs.enqueue({
      type: JobType.RENDER,
      projectId,
      payload: {
        projectId,
        requestedBy: userId,
        inputFingerprint,
        renderJobId: "pending",
        timelineId: timeline.id,
        timelineVersion: timeline.version,
        outputProfile,
      } satisfies RenderQueuePayload,
    });

    const renderJob = await prisma.renderJob.create({
      data: {
        projectId,
        timelineId: timeline.id,
        timelineVersion: timeline.version,
        jobId: job.id,
        inputFingerprint,
        capability: RenderCapability.VIDEO_RENDER,
        status: RenderJobStatus.QUEUED,
        payload: { manifest } satisfies RenderJobPayloadDocument as Prisma.InputJsonValue,
      },
    });

    await prisma.job.update({
      where: { id: job.id },
      data: {
        payload: {
          projectId,
          requestedBy: userId,
          inputFingerprint,
          renderJobId: renderJob.id,
          timelineId: timeline.id,
          timelineVersion: timeline.version,
          outputProfile,
        } satisfies RenderQueuePayload as Prisma.InputJsonValue,
      },
    });

    logger.info("render.queued", {
      userId,
      projectId,
      jobId: job.id,
      renderJobId: renderJob.id,
      inputFingerprint,
    });
    return { jobId: job.id, status: JobStatus.PENDING, inputFingerprint };
  }

  async cancelJob(userId: string, projectId: string, jobId: string) {
    await this.projects.getForUser(userId, projectId);
    const job = await this.jobs.get(jobId);
    if (!job || job.projectId !== projectId || job.type !== JobType.RENDER) {
      throw AppError.notFound("That render job was not found.");
    }
    const cancelled = await this.jobs.cancel(jobId);
    await this.mirrorRenderJobStatus(jobId, RenderJobStatus.CANCELLED, {
      onlyIfOpen: true,
    });
    return this.toJobStatus(cancelled);
  }

  async getJobStatus(userId: string, projectId: string, jobId: string): Promise<RenderJobStatusView> {
    await this.projects.getForUser(userId, projectId);
    const job = await this.jobs.get(jobId);
    if (!job || job.projectId !== projectId || job.type !== JobType.RENDER) {
      throw AppError.notFound("That render job was not found.");
    }
    return this.toJobStatus(job);
  }

  async getLatestSuccessful(userId: string, projectId: string): Promise<RenderView | null> {
    await this.projects.getForUser(userId, projectId);
    const row = await prisma.renderJob.findFirst({
      where: { projectId, status: RenderJobStatus.SUCCEEDED },
      orderBy: { createdAt: "desc" },
    });
    return row ? this.toView(row) : null;
  }

  async listRenders(userId: string, projectId: string): Promise<RenderView[]> {
    await this.projects.getForUser(userId, projectId);
    const rows = await prisma.renderJob.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async processJob(job: JobRecord): Promise<{ cancelled: boolean; renderJobId: string | null }> {
    const payload = job.payload as RenderQueuePayload | null;
    if (!payload?.projectId || !payload.requestedBy || !payload.renderJobId) {
      throw AppError.jobFailed("Render job is missing project context.");
    }

    const resolved = this.resolveRenderer();
    if (!resolved) {
      throw AppError.providerNotConfigured("RendererPort");
    }

    const userId = payload.requestedBy;
    const projectId = payload.projectId;
    await this.projects.getForUser(userId, projectId);

    const renderJob = await prisma.renderJob.findFirst({
      where: { id: payload.renderJobId, projectId },
    });
    if (!renderJob) {
      throw AppError.jobFailed("Render job row is missing.");
    }

    if (await this.isCancelled(job.id)) {
      await this.mirrorRenderJobStatus(job.id, RenderJobStatus.CANCELLED);
      return { cancelled: true, renderJobId: renderJob.id };
    }

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: RenderJobStatus.RUNNING },
    });

    const startedAt = Date.now();
    logger.info("render.started", { projectId, jobId: job.id, renderJobId: renderJob.id });

    const { timeline, manifest } = await this.contract.assembleManifest(
      userId,
      projectId,
      payload.outputProfile,
    );
    if (timeline.id !== payload.timelineId || timeline.version !== payload.timelineVersion) {
      throw AppError.renderTimelineRequired("The READY cut changed before it could be rendered.");
    }

    const destinationKeyHint = `projects/${projectId}/renders/${renderJob.id}/output.mp4`;
    const input = this.contract.composeInput({
      projectId,
      timeline,
      manifest,
      destinationKeyHint,
    });

    const { attribution } = resolved;
    let rawResult;
    try {
      rawResult = await resolved.adapter.render(input);
    } catch (error) {
      await this.usage.recordJobUsage({
        userId,
        projectId,
        jobId: job.id,
        kind: UsageKind.RENDER_SECONDS,
        quantity: 0,
        outcome: UsageOutcome.FAILED,
        providerKey: attribution.providerKey,
        capability: attribution.capability,
      });
      throw error;
    }
    const result = this.contract.validateResult(rawResult);
    if ("providerKey" in (rawResult as object)) {
      throw AppError.renderResultInvalid(
        "RendererPort must not return providerKey. Attribution lives outside the port.",
      );
    }
    await this.assertStoredBytes(result);

    if (await this.isCancelled(job.id)) {
      await this.mirrorRenderJobStatus(job.id, RenderJobStatus.CANCELLED);
      return { cancelled: true, renderJobId: renderJob.id };
    }

    await this.usage.recordJobUsage({
      userId,
      projectId,
      jobId: job.id,
      kind: UsageKind.RENDER_SECONDS,
      quantity: (result.durationMs ?? 0) / 1000,
      outcome: UsageOutcome.SUCCEEDED,
      providerKey: attribution.providerKey,
      capability: attribution.capability,
    });

    const stored = await this.storage.get(result.storageKey);
    const byteSize = result.byteSize ?? stored?.body.byteLength ?? null;
    const checksum =
      result.checksum ??
      (stored ? createHash("sha256").update(stored.body).digest("hex") : null);

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: {
        status: RenderJobStatus.SUCCEEDED,
        providerKey: attribution.providerKey,
        capability: attribution.capability,
        modelId: attribution.modelId,
        modelVersion: attribution.modelVersion,
        outputKey: result.storageKey,
        mimeType: result.mimeType,
        durationMs: result.durationMs,
        byteSize: byteSize !== null ? BigInt(byteSize) : null,
        checksum,
        error: null,
        payload: {
          manifest,
          progress: { percent: 100, stage: "complete" },
        } satisfies RenderJobPayloadDocument as Prisma.InputJsonValue,
      },
    });

    await this.attribution.record({
      projectId,
      jobId: job.id,
      providerKey: attribution.providerKey,
      capability: attribution.capability,
      modelId: attribution.modelId,
      modelVersion: attribution.modelVersion,
    });

    logger.info("render.completed", {
      projectId,
      jobId: job.id,
      renderJobId: renderJob.id,
      inputFingerprint: payload.inputFingerprint,
      durationMs: Date.now() - startedAt,
    });

    return { cancelled: false, renderJobId: renderJob.id };
  }

  async markFailed(jobId: string, error: string) {
    await this.mirrorRenderJobStatus(jobId, RenderJobStatus.FAILED, { error, onlyIfOpen: true });
  }

  toView(row: {
    id: string;
    projectId: string;
    status: string;
    timelineId: string;
    timelineVersion: number;
    jobId: string | null;
    inputFingerprint: string;
    outputKey: string | null;
    mimeType: string | null;
    durationMs: number | null;
    byteSize: bigint | null;
    checksum: string | null;
    payload: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): RenderView {
    const payload = row.payload as RenderJobPayloadDocument | null;
    return {
      id: row.id,
      projectId: row.projectId,
      status: row.status,
      timelineId: row.timelineId,
      timelineVersion: row.timelineVersion,
      jobId: row.jobId,
      inputFingerprint: row.inputFingerprint,
      outputProfile: payload?.manifest.outputProfile ?? null,
      mimeType: row.mimeType,
      durationMs: row.durationMs,
      byteSize: row.byteSize !== null ? Number(row.byteSize) : null,
      checksum: row.checksum,
      progress: payload?.progress ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async findOpenJob(projectId: string, inputFingerprint: string) {
    const jobs = await this.jobs.listByProject(projectId);
    return (
      jobs.find((job) => {
        if (job.type !== JobType.RENDER) {
          return false;
        }
        if (job.status !== JobStatus.PENDING && job.status !== JobStatus.RUNNING) {
          return false;
        }
        const payload = job.payload as RenderQueuePayload | null;
        return payload?.inputFingerprint === inputFingerprint;
      }) ?? null
    );
  }

  private async isCancelled(jobId: string) {
    const current = await this.jobs.get(jobId);
    return current?.status === JobStatus.CANCELLED;
  }

  private async assertStoredBytes(result: { storageKey: string; checksum?: string }) {
    const stored = await this.storage.get(result.storageKey);
    if (!stored || stored.body.byteLength === 0) {
      throw AppError.renderResultInvalid("Successful renders require a StoragePort write.");
    }
    if (result.checksum) {
      const actual = createHash("sha256").update(stored.body).digest("hex");
      if (actual !== result.checksum) {
        throw AppError.renderResultInvalid("Render checksum does not match stored bytes.");
      }
    }
  }

  private async mirrorRenderJobStatus(
    jobId: string,
    status: string,
    options: { error?: string; onlyIfOpen?: boolean } = {},
  ) {
    const row = await prisma.renderJob.findFirst({ where: { jobId } });
    if (!row) {
      return;
    }
    if (options.onlyIfOpen) {
      if (
        row.status === RenderJobStatus.SUCCEEDED ||
        row.status === RenderJobStatus.FAILED ||
        row.status === RenderJobStatus.CANCELLED
      ) {
        return;
      }
    }
    await prisma.renderJob.update({
      where: { id: row.id },
      data: {
        status,
        error: options.error ?? row.error,
      },
    });
  }

  private async toJobStatus(job: JobRecord): Promise<RenderJobStatusView> {
    const row = await prisma.renderJob.findFirst({
      where: { projectId: job.projectId ?? undefined, jobId: job.id },
    });
    const payload = job.payload as RenderQueuePayload | null;
    const storedPayload = row?.payload as RenderJobPayloadDocument | null;
    return {
      jobId: job.id,
      renderJobId: row?.id ?? null,
      status: job.status,
      renderStatus: row?.status ?? null,
      error: job.error ?? row?.error ?? null,
      inputFingerprint: payload?.inputFingerprint ?? row?.inputFingerprint ?? null,
      progress: storedPayload?.progress ?? null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }
}
