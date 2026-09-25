import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { AppError, isAppError } from "@/lib/errors";
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
import type { UsageMeterPort } from "@/server/ports/usage-meter";
import { AttributionService } from "@/server/services/attribution";
import { EntitlementService } from "@/server/services/entitlement";
import { ProjectService } from "@/server/services/projects";
import { UsageMeterService } from "@/server/services/usage-meter";
import { UsageKind, UsageOutcome } from "@/server/usage/types";
import { PrismaAiVideoBudget, AiVideoBudgetCapError, type AiVideoBudgetPort, type AiVideoBudgetReservationRecord } from "@/server/sg/ai-video-budget";
import {
  AiVideoBudgetSource,
  hasAnyBudgetCap,
} from "@/server/sg/budget-source";
import {
  actualBilledSecondsFromDurationMs,
  estimateLaneCharge,
  requireLaneRate,
} from "@/server/sg/lane-rate";

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
    private readonly usage: UsageMeterPort = new UsageMeterService(),
    private readonly entitlements: EntitlementService = new EntitlementService(),
    private readonly budgets: AiVideoBudgetPort = new PrismaAiVideoBudget(prisma),
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
    await this.entitlements.requirePaidEnqueue(userId, {
      requireConsent: this.availability().productionAvailable,
    });

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

      const attribution = resolved.attributionFor(capability);
      const budgetHold = await this.reserveProductionBudget({
        userId,
        projectId,
        job,
        role: role.role,
        storySceneId: role.storySceneId,
      });
      let rawDocument;
      try {
        rawDocument = await resolved.adapter.generate(input);
        if (budgetHold) {
          await this.reconcileBudget(budgetHold, rawDocument.durationMs);
        }
      } catch (error) {
        if (budgetHold) {
          await this.settleBudgetFailure(budgetHold, error);
        }
        await this.usage.recordJobUsage({
          userId,
          projectId,
          jobId: job.id,
          kind: UsageKind.ASSET_CALL,
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
        kind: UsageKind.ASSET_CALL,
        quantity: 1,
        outcome: UsageOutcome.SUCCEEDED,
        providerKey: attribution.providerKey,
        capability: attribution.capability,
      });
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

  /**
   * Books project + user-window seconds before the adapter runs.
   * The lane's configured clip duration is the billed length. Per-shot duration
   * is not an AssetGeneratorInput field.
   * Returns null when this process is not on a production generator, or when
   * no lane and no ops cap is configured (those scopes stay unenforced).
   */
  private async reserveProductionBudget(input: {
    userId: string;
    projectId: string;
    job: JobRecord;
    role: string;
    storySceneId?: string;
  }): Promise<AiVideoBudgetReservationRecord | null> {
    if (!this.availability().productionAvailable) {
      return null;
    }
    const resolved = AiVideoBudgetSource.resolve(input.userId, input.projectId);
    const laneId = process.env.YF_GATEWAY_LANE_ID?.trim();
    if (!laneId) {
      if (!hasAnyBudgetCap(resolved.caps)) {
        return null;
      }
      logger.info("asset.cap_denied", {
        settleReason: "CAP_DENIED",
        userId: input.userId,
        projectId: input.projectId,
        jobId: input.job.id,
        detail: "budget cap set without YF_GATEWAY_LANE_ID",
      });
      throw AppError.spendCapReached(
        "Clip generation is paused because a usage limit was reached. We did not retry automatically.",
      );
    }
    let lane;
    try {
      lane = requireLaneRate(laneId, registryPathFromEnv());
    } catch (error) {
      throw AppError.assetProviderUnavailable(
        error instanceof Error ? error.message : "AI video lane registry failed closed.",
      );
    }
    const charge = estimateLaneCharge(lane);
    try {
      return await this.budgets.reserve({
        idempotencyKey: `asset:${input.job.id}:${input.role}:${input.storySceneId ?? "-"}:${input.job.attempts}`,
        projectId: input.projectId,
        userId: input.userId,
        windowKey: resolved.windowKey,
        laneId: lane.laneId,
        providerKey: lane.providerKey,
        estimatedBilledSeconds: charge.estimatedBilledSeconds,
        usdPerSecond: lane.usdPerSecond,
        estimatedUsd: charge.reservedUsd,
        caps: resolved.caps,
      });
    } catch (error) {
      if (error instanceof AiVideoBudgetCapError) {
        logger.info("asset.cap_denied", {
          settleReason: "CAP_DENIED",
          userId: input.userId,
          projectId: input.projectId,
          jobId: input.job.id,
          laneId: lane.laneId,
          message: error.message,
        });
        throw AppError.spendCapReached(error.message);
      }
      throw error;
    }
  }

  private async reconcileBudget(
    hold: AiVideoBudgetReservationRecord,
    durationMs: number | undefined,
  ) {
    const lane = requireLaneRate(hold.laneId, registryPathFromEnv());
    const actual = actualBilledSecondsFromDurationMs(
      durationMs,
      lane.billingGranularityS,
      hold.estimatedBilledSeconds,
    );
    await this.budgets.reconcile(hold.id, {
      actualBilledSeconds: actual.seconds,
      reason: actual.flagged ? "ACTUAL_DURATION_FALLBACK" : "SUCCEEDED",
    });
  }

  private async settleBudgetFailure(hold: AiVideoBudgetReservationRecord, error: unknown) {
    if (isAppError(error) && error.code === "SPEND_CAP_REACHED") {
      await this.budgets.release(hold.id, "CAP_DENIED");
      logger.info("asset.cap_denied", {
        settleReason: "CAP_DENIED",
        reservationId: hold.id,
        projectId: hold.projectId,
        userId: hold.userId,
        laneId: hold.laneId,
      });
      return;
    }
    const message = error instanceof Error ? error.message : "";
    if (/timeout|timed out|abort|cancel/i.test(message)) {
      await this.budgets.markUnreconciled(hold.id, "TIMEOUT_OR_CANCEL");
      return;
    }
    const lane = requireLaneRate(hold.laneId, registryPathFromEnv());
    if (lane.failuresBillable) {
      await this.budgets.reconcile(hold.id, {
        actualBilledSeconds: hold.estimatedBilledSeconds,
        reason: "FAILURE_BILLABLE",
      });
      return;
    }
    await this.budgets.release(hold.id, "FAILURE_NOT_BILLABLE");
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

function registryPathFromEnv(): string | undefined {
  const path = process.env.SG_LANE_REGISTRY_PATH?.trim();
  return path ? path : undefined;
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
