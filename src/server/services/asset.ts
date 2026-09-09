import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AssetExecutionAttribution } from "@/server/adapters/assets/attribution";
import { fingerprintAssetBatchRequest, fingerprintAssetGeneratorInput } from "@/server/assets/fingerprint";
import {
  capabilityForKind,
  inferKindFromRole,
  isGeneratedAssetKind,
  type GeneratedAssetKind,
} from "@/server/assets/kinds";
import type { GeneratedAssetDocument } from "@/server/assets/schema";
import type { AssetAvailability } from "@/server/assets/provider-config";
import { prisma } from "@/server/db";
import {
  GeneratedAssetStatus,
  JobStatus,
  JobType,
  TimelineStatus,
} from "@/server/domain/status";
import type { AssetCapabilityValue } from "@/server/ports/capabilities";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { JobQueuePort, JobRecord } from "@/server/ports/jobs";
import type { StoragePort, StorageReadRange } from "@/server/ports/storage";
import {
  AssetContractService,
  parseStoryDocumentJson,
  parseTimelineDocumentJson,
  resolveUnmetRoles,
  type AssetRoleRequest,
  type ReadyTimelineSource,
} from "@/server/services/asset-contract";
import { AttributionService } from "@/server/services/attribution";
import { ProjectService } from "@/server/services/projects";

export type GeneratedAssetView = {
  id: string;
  projectId: string;
  status: string;
  kind: string;
  origin: string;
  role: string;
  mimeType: string;
  byteSize: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  document: GeneratedAssetDocument;
  jobId: string | null;
  inputFingerprint: string;
  timelineId: string | null;
  timelineVersion: number | null;
  storySceneId: string | null;
  sourceMediaAssetId: string | null;
  replacesAssetId: string | null;
  previewUrl: string | null;
  originalUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetJobStatusView = {
  jobId: string;
  status: string;
  error: string | null;
  inputFingerprint: string | null;
  assetIds: string[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type AssetGenerateRequest = {
  roles?: AssetRoleRequest[];
};

export type ResolvedAssetRuntime = {
  adapter: AssetGeneratorPort;
  attributionFor: (capability: AssetCapabilityValue) => AssetExecutionAttribution;
  supportedCapabilities: AssetCapabilityValue[];
};

type AssetJobPayload = {
  projectId: string;
  requestedBy: string;
  inputFingerprint: string;
  roles: AssetRoleRequest[];
  timelineId: string;
  timelineVersion: number;
};

/**
 * M3 generated/processed assets. Assembles input, generates via AssetGeneratorPort,
 * validates, persists GeneratedAsset rows, and records attribution.
 * Does not write RenderJob, FinishedMovie, Publication, or mutate Story/Timeline payloads.
 * Does not silently rebuild Timeline on generation success (D9).
 */
export class AssetService {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly storage: StoragePort,
    private readonly contract: AssetContractService,
    private readonly projects: ProjectService,
    private readonly attribution: AttributionService,
    private readonly resolveGenerator: () => ResolvedAssetRuntime | null,
    private readonly availability: () => AssetAvailability,
  ) {}

  getAvailability(): AssetAvailability {
    return this.availability();
  }

  requireGenerateCapability(kind?: GeneratedAssetKind) {
    const avail = this.availability();
    if (kind) {
      const capability = capabilityForKind(kind);
      const slot = avail.capabilities[capability];
      if (!slot?.canGenerate) {
        throw AppError.assetCapabilityUnavailable(capability);
      }
      if (!slot.productionAvailable && slot.localDevAvailable) {
        return { mode: "local" as const, capability };
      }
      if (!slot.productionAvailable) {
        throw AppError.assetCapabilityUnavailable(capability);
      }
      return { mode: "production" as const, capability };
    }
    if (!avail.canGenerate) {
      throw AppError.providerNotConfigured("AssetGeneratorPort");
    }
    if (!avail.productionAvailable && avail.localDevAvailable) {
      return { mode: "local" as const };
    }
    if (!avail.productionAvailable) {
      throw AppError.providerNotConfigured("AssetGeneratorPort");
    }
    return { mode: "production" as const };
  }

  async requestGenerate(userId: string, projectId: string, body: AssetGenerateRequest = {}) {
    await this.projects.getForUser(userId, projectId);
    const timeline = await this.requireReadyTimeline(projectId);
    const roles = this.resolveRequestedRoles(timeline, body.roles);
    if (roles.length === 0) {
      throw AppError.assetInputInvalid("There are no missing pieces to generate.");
    }
    for (const role of roles) {
      this.requireGenerateCapability(role.kind);
    }

    const inputFingerprint = fingerprintAssetBatchRequest({
      projectId,
      timelineId: timeline.id,
      timelineVersion: timeline.version,
      roles: roles.map((item) => ({
        role: item.role,
        storySceneId: item.storySceneId,
        kind: item.kind!,
      })),
    });

    const open = await this.findOpenJob(projectId, inputFingerprint);
    if (open) {
      logger.info("asset.enqueue_idempotent", {
        userId,
        projectId,
        jobId: open.id,
        inputFingerprint,
      });
      return { jobId: open.id, status: open.status, inputFingerprint };
    }

    const job = await this.jobs.enqueue({
      type: JobType.AI_ASSET,
      projectId,
      payload: {
        projectId,
        requestedBy: userId,
        inputFingerprint,
        roles,
        timelineId: timeline.id,
        timelineVersion: timeline.version,
      } satisfies AssetJobPayload,
    });

    logger.info("asset.queued", { userId, projectId, jobId: job.id, inputFingerprint });
    return { jobId: job.id, status: JobStatus.PENDING, inputFingerprint };
  }

  async cancelJob(userId: string, projectId: string, jobId: string) {
    await this.projects.getForUser(userId, projectId);
    const job = await this.jobs.get(jobId);
    if (!job || job.projectId !== projectId || job.type !== JobType.AI_ASSET) {
      throw AppError.notFound("That missing-pieces job was not found.");
    }
    const cancelled = await this.jobs.cancel(jobId);
    return this.toJobStatus(cancelled);
  }

  async getJobStatus(userId: string, projectId: string, jobId: string): Promise<AssetJobStatusView> {
    await this.projects.getForUser(userId, projectId);
    const job = await this.jobs.get(jobId);
    if (!job || job.projectId !== projectId || job.type !== JobType.AI_ASSET) {
      throw AppError.notFound("That missing-pieces job was not found.");
    }
    return this.toJobStatus(job);
  }

  async listAssets(userId: string, projectId: string): Promise<GeneratedAssetView[]> {
    await this.projects.getForUser(userId, projectId);
    const rows = await prisma.generatedAsset.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async getLatestFulfillments(userId: string, projectId: string): Promise<GeneratedAssetView[]> {
    await this.projects.getForUser(userId, projectId);
    const rows = await prisma.generatedAsset.findMany({
      where: { projectId, status: GeneratedAssetStatus.READY },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async openFile(
    userId: string,
    projectId: string,
    assetId: string,
    variant: "original" | "preview" = "original",
    range?: StorageReadRange,
  ) {
    await this.projects.getForUser(userId, projectId);
    const row = await prisma.generatedAsset.findFirst({
      where: { id: assetId, projectId },
    });
    if (!row) {
      throw AppError.notFound("That generated piece was not found.");
    }
    const key = variant === "preview" ? row.previewKey ?? row.storageKey : row.storageKey;
    const stream = await this.storage.getStream(key, range);
    if (!stream) {
      throw AppError.notFound("That generated file was not found.");
    }
    return {
      mimeType: row.mimeType,
      filename: `${row.role}.${extensionFromMime(row.mimeType)}`,
      stream,
    };
  }

  async processJob(job: JobRecord): Promise<{ cancelled: boolean; assetIds: string[] }> {
    const payload = job.payload as AssetJobPayload | null;
    if (!payload?.projectId || !payload.requestedBy || !payload.roles?.length) {
      throw AppError.jobFailed("Asset job is missing project context.");
    }

    const resolved = this.resolveGenerator();
    if (!resolved) {
      throw AppError.providerNotConfigured("AssetGeneratorPort");
    }

    const userId = payload.requestedBy;
    const projectId = payload.projectId;
    await this.projects.getForUser(userId, projectId);
    const timeline = await this.requireReadyTimeline(projectId);
    if (timeline.id !== payload.timelineId || timeline.version !== payload.timelineVersion) {
      throw AppError.assetTimelineRequired(
        "The READY cut changed before missing pieces could be generated.",
      );
    }
    const story = await this.loadStory(timeline.storyStructureId);
    const assetIds: string[] = [];

    for (const role of payload.roles) {
      if (await this.isCancelled(job.id)) {
        return { cancelled: true, assetIds };
      }

      const alreadyReady = await prisma.generatedAsset.findFirst({
        where: {
          projectId,
          jobId: job.id,
          role: role.role,
          storySceneId: role.storySceneId ?? null,
          status: GeneratedAssetStatus.READY,
        },
      });
      if (alreadyReady) {
        assetIds.push(alreadyReady.id);
        continue;
      }

      const kind = role.kind ?? inferKindFromRole(role.role);
      const capability = capabilityForKind(kind);
      if (!resolved.supportedCapabilities.includes(capability)) {
        await this.persistFailed({
          projectId,
          jobId: job.id,
          role,
          kind,
          timeline,
          capability,
          error: `No ready adapter can perform ${capability}.`,
        });
        throw AppError.assetCapabilityUnavailable(capability);
      }

      const input = await this.contract.assembleInput(userId, projectId, timeline, role, story);
      const inputFingerprint = fingerprintAssetGeneratorInput(input);
      const startedAt = Date.now();
      logger.info("asset.started", { projectId, jobId: job.id, role: role.role, kind });

      const rawDocument = await resolved.adapter.generate(input);
      const document = this.contract.validateDocument(input, rawDocument);
      await this.assertStoredBytes(document);

      const priorReady = await prisma.generatedAsset.findFirst({
        where: {
          projectId,
          timelineId: timeline.id,
          role: role.role,
          status: GeneratedAssetStatus.READY,
          ...(role.storySceneId ? { storySceneId: role.storySceneId } : {}),
        },
        orderBy: { createdAt: "desc" },
      });

      const attribution = resolved.attributionFor(capability);
      const stored = await prisma.$transaction(async (tx) => {
        if (priorReady) {
          await tx.generatedAsset.update({
            where: { id: priorReady.id },
            data: { status: GeneratedAssetStatus.SUPERSEDED },
          });
        }
        return tx.generatedAsset.create({
          data: {
            projectId,
            status: GeneratedAssetStatus.READY,
            kind: document.kind,
            origin: document.origin,
            role: document.role,
            mimeType: document.mimeType,
            byteSize: BigInt((await this.storage.get(document.storageKey))?.body.byteLength ?? 0),
            storageKey: document.storageKey,
            previewKey: document.previewKey ?? null,
            durationMs: document.durationMs ?? null,
            width: document.width ?? null,
            height: document.height ?? null,
            checksum: document.checksum ?? null,
            payload: document as Prisma.InputJsonValue,
            jobId: job.id,
            inputFingerprint,
            providerKey: attribution.providerKey,
            capability: attribution.capability,
            modelId: attribution.modelId,
            modelVersion: attribution.modelVersion,
            timelineId: timeline.id,
            timelineVersion: timeline.version,
            storySceneId: document.fulfillment.storySceneId ?? role.storySceneId ?? null,
            storyStructureId: input.storyStructureId ?? null,
            storyStructureVersion: input.storyStructureVersion ?? null,
            sourceMediaAssetId: document.sourceMediaAssetId ?? null,
            replacesAssetId: priorReady?.id ?? null,
          },
        });
      });

      await this.attribution.record({
        projectId,
        generatedAssetId: stored.id,
        jobId: job.id,
        providerKey: attribution.providerKey,
        capability: attribution.capability,
        modelId: attribution.modelId,
        modelVersion: attribution.modelVersion,
      });

      assetIds.push(stored.id);
      logger.info("asset.completed", {
        projectId,
        jobId: job.id,
        generatedAssetId: stored.id,
        role: role.role,
        kind,
        inputFingerprint,
        durationMs: Date.now() - startedAt,
      });
    }

    if (await this.isCancelled(job.id)) {
      return { cancelled: true, assetIds };
    }
    return { cancelled: false, assetIds };
  }

  toView(row: {
    id: string;
    projectId: string;
    status: string;
    kind: string;
    origin: string;
    role: string;
    mimeType: string;
    byteSize: bigint;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    checksum: string | null;
    payload: Prisma.JsonValue;
    jobId: string | null;
    inputFingerprint: string;
    timelineId: string | null;
    timelineVersion: number | null;
    storySceneId: string | null;
    sourceMediaAssetId: string | null;
    replacesAssetId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): GeneratedAssetView {
    return {
      id: row.id,
      projectId: row.projectId,
      status: row.status,
      kind: row.kind,
      origin: row.origin,
      role: row.role,
      mimeType: row.mimeType,
      byteSize: Number(row.byteSize),
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      checksum: row.checksum,
      document: row.payload as GeneratedAssetDocument,
      jobId: row.jobId,
      inputFingerprint: row.inputFingerprint,
      timelineId: row.timelineId,
      timelineVersion: row.timelineVersion,
      storySceneId: row.storySceneId,
      sourceMediaAssetId: row.sourceMediaAssetId,
      replacesAssetId: row.replacesAssetId,
      previewUrl: `/api/projects/${row.projectId}/generated-assets/${row.id}/file?variant=preview`,
      originalUrl: `/api/projects/${row.projectId}/generated-assets/${row.id}/file`,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async requireReadyTimeline(projectId: string): Promise<ReadyTimelineSource> {
    const row = await prisma.timeline.findFirst({
      where: { projectId, status: TimelineStatus.READY },
      orderBy: { version: "desc" },
    });
    if (!row || !row.payload) {
      throw AppError.assetTimelineRequired();
    }
    return {
      id: row.id,
      version: row.version,
      document: parseTimelineDocumentJson(row.payload),
      storyStructureId: row.storyStructureId,
      storyStructureVersion: row.storyStructureVersion,
    };
  }

  private resolveRequestedRoles(
    timeline: ReadyTimelineSource,
    explicit?: AssetRoleRequest[],
  ): AssetRoleRequest[] {
    if (explicit && explicit.length > 0) {
      return explicit.map((item) => ({
        ...item,
        kind: item.kind ?? inferKindFromRole(item.role),
      }));
    }
    return resolveUnmetRoles(timeline.document).map((item) => ({
      role: item.role,
      storySceneId: item.storySceneId,
      reason: item.reason,
      kind: inferKindFromRole(item.role),
    }));
  }

  private async findOpenJob(projectId: string, inputFingerprint: string) {
    const jobs = await this.jobs.listByProject(projectId);
    return (
      jobs.find((job) => {
        if (job.type !== JobType.AI_ASSET) {
          return false;
        }
        if (job.status !== JobStatus.PENDING && job.status !== JobStatus.RUNNING) {
          return false;
        }
        const payload = job.payload as AssetJobPayload | null;
        return payload?.inputFingerprint === inputFingerprint;
      }) ?? null
    );
  }

  private async loadStory(storyStructureId: string) {
    const row = await prisma.storyStructure.findUnique({
      where: { id: storyStructureId },
    });
    return row?.payload ? parseStoryDocumentJson(row.payload) : null;
  }

  private async isCancelled(jobId: string) {
    const current = await this.jobs.get(jobId);
    return current?.status === JobStatus.CANCELLED;
  }

  private async assertStoredBytes(document: GeneratedAssetDocument) {
    const stored = await this.storage.get(document.storageKey);
    if (!stored || stored.body.byteLength === 0) {
      throw AppError.assetDocumentInvalid(
        "READY generated assets require a successful StoragePort write.",
      );
    }
    if (document.checksum) {
      const actual = createHash("sha256").update(stored.body).digest("hex");
      if (actual !== document.checksum) {
        throw AppError.assetDocumentInvalid("Generated asset checksum does not match stored bytes.");
      }
    }
  }

  private async persistFailed(input: {
    projectId: string;
    jobId: string;
    role: AssetRoleRequest;
    kind: GeneratedAssetKind;
    timeline: ReadyTimelineSource;
    capability: AssetCapabilityValue;
    error: string;
  }) {
    await prisma.generatedAsset.create({
      data: {
        projectId: input.projectId,
        status: GeneratedAssetStatus.FAILED,
        kind: input.kind,
        origin: input.kind === "ENHANCEMENT" ? "PROCESSED" : "GENERATED",
        role: input.role.role,
        mimeType: "application/octet-stream",
        byteSize: BigInt(0),
        storageKey: `projects/${input.projectId}/generated/${input.role.role}/failed`,
        payload: {
          schemaVersion: "1.0",
          kind: input.kind,
          role: input.role.role,
          mimeType: "application/octet-stream",
          storageKey: `projects/${input.projectId}/generated/${input.role.role}/failed`,
          origin: input.kind === "ENHANCEMENT" ? "PROCESSED" : "GENERATED",
          fulfillment: {
            timelineId: input.timeline.id,
            timelineVersion: input.timeline.version,
            storySceneId: input.role.storySceneId,
            unmetReason: input.error,
          },
          source: {
            storyStructureId: input.timeline.storyStructureId,
            storyStructureVersion: input.timeline.storyStructureVersion,
          },
        } as Prisma.InputJsonValue,
        jobId: input.jobId,
        inputFingerprint: "failed",
        providerKey: "none",
        capability: input.capability,
        timelineId: input.timeline.id,
        timelineVersion: input.timeline.version,
        storySceneId: input.role.storySceneId ?? null,
      },
    });
  }

  private async toJobStatus(job: JobRecord): Promise<AssetJobStatusView> {
    const rows = await prisma.generatedAsset.findMany({
      where: { projectId: job.projectId ?? undefined, jobId: job.id },
      select: { id: true },
    });
    const payload = job.payload as AssetJobPayload | null;
    return {
      jobId: job.id,
      status: job.status,
      error: job.error,
      inputFingerprint: payload?.inputFingerprint ?? null,
      assetIds: rows.map((row) => row.id),
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }
}

function extensionFromMime(mimeType: string) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4")) return "mp4";
  return "bin";
}

export { isGeneratedAssetKind };
