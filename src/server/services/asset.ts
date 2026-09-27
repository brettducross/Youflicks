import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { OpsAlertKind, reportOpsAlert } from "@/lib/ops-alerts";
import type { AssetExecutionAttribution } from "@/server/adapters/assets/attribution";
import { fingerprintAssetBatchRequest, fingerprintAssetGeneratorInput } from "@/server/assets/fingerprint";
import {
  capabilityForKind,
  inferKindFromRole,
  isGeneratedAssetKind,
  type GeneratedAssetKind,
} from "@/server/assets/kinds";
import type { GeneratedAssetDocument } from "@/server/assets/schema";
import {
  buildKenBurnsParams,
  isKenBurnsProcessor,
  KEN_BURNS_PROVIDER_KEY,
  type KenBurnsTreatmentParams,
} from "@/server/assets/kenburns";
import type { AssetLaneResolver } from "@/server/assets/lane-resolver";
import type { AssetAvailability } from "@/server/assets/provider-config";
import { prisma } from "@/server/db";
import {
  GeneratedAssetStatus,
  JobStatus,
  JobType,
  TimelineStatus,
} from "@/server/domain/status";
import { AssetCapability, type AssetCapabilityValue } from "@/server/ports/capabilities";
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
  projectBudgetLedgerId,
  userWindowBudgetLedgerId,
} from "@/server/sg/budget-source";
import { gatewayTraceFor } from "@/server/assets/gateway-trace";
import { attemptOutcomeFromSettlement } from "@/server/sg/attempt-outcome";
import {
  actualBilledSecondsFromDurationMs,
  estimateLaneCharge,
  requireLaneRate,
  requireLiveLane,
} from "@/server/sg/lane-rate";
import {
  collectShotCueInput,
  loadSceneEmphasis,
  type CollectShotCueArgs,
  type CueReadDb,
} from "@/server/sg/cue-context";
import {
  extractShotCues,
  persistableShotCues,
  requiredScopesFor,
  stricterIdentityState,
  tightenIdentityForRoute,
  type ShotCueInput,
} from "@/server/sg/cues";
import { probeEligibleLaneHealth, probeLaneHealth } from "@/server/sg/lane-health";
import { GENERATIVE_LANE_CAPABILITIES, readLaneHealthBaseUrl } from "@/server/assets/lane-resolver";
import {
  applyLaneSuspension,
  DEFAULT_SG_LANE_REGISTRY_PATH,
  listEligibleLanes,
  loadSgLaneRegistry,
  reportLaneRegistryInvalid,
  reportUnknownSuspendedLanes,
  suspendedLaneIdsFromEnv,
  type RegistryLane,
  type SgLaneRegistry,
} from "@/server/sg/lane-registry";
import {
  assertEnforcedLaneCallable,
  blocksAutomaticPaidRetry,
  fulfillmentStatusForTreatment,
  legacyModelGuard,
  planRoute,
  type AttemptSoFar,
  type BudgetSnapshot,
  type RegistrySnapshot,
  type RouteDecision,
  type ShotCues,
} from "@/server/sg/policy";
import {
  DEFAULT_RENDER_OUTPUT_PROFILE,
  RENDER_OUTPUT_PROFILES,
  type RenderOutputProfile,
} from "@/server/render/schema";
import { readSgRoutingMode } from "@/server/sg/routing-mode";
import {
  deriveSlotCoverage,
  panAnchorFromAnalysis,
  type CoverageAsset,
  type SlotCoverage,
} from "@/server/sg/slot-coverage";
import { attemptOutcomeSchema, laneClassSchema, SG_MESSAGE_KEYS, type RoutingMode } from "@/server/sg/constants";
import { SG_COPY } from "@/server/sg/messages";
import {
  presentSlotMessages,
  type AppliedSlotState,
  type PresenterRoleKind,
  type SlotMessageView,
} from "@/server/sg/presenter";
import {
  PrismaShotFulfillment,
  UNCLASSIFIED_LANE_CLASS,
} from "@/server/sg/shot-fulfillment";

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

export type ShotCueCollector = (db: CueReadDb, args: CollectShotCueArgs) => Promise<ShotCueInput>;

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
    private readonly fulfillments: PrismaShotFulfillment = new PrismaShotFulfillment(prisma),
    private readonly collectCues: ShotCueCollector = collectShotCueInput,
    private readonly resolveLanes: () => AssetLaneResolver | null = () => null,
    private readonly probeHealth: (baseUrl: string) => Promise<boolean> = (baseUrl) =>
      probeLaneHealth(baseUrl),
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

  /**
   * Applied SG.6 copy for roles still in the latest READY timeline. Owner-only.
   * Slots stay on the timeline version they were generated against, so a Rebuild
   * must not hide them. Never returns decision reasons, shadow decisions, lane ids, or cost fields.
   */
  async listSlotMessages(userId: string, projectId: string): Promise<SlotMessageView[]> {
    await this.projects.getForUser(userId, projectId);
    const timeline = await prisma.timeline.findFirst({
      where: { projectId, status: TimelineStatus.READY },
      orderBy: { version: "desc" },
      select: { id: true, version: true, payload: true },
    });
    if (!timeline) {
      return [];
    }
    const slots = (
      await prisma.shotFulfillment.findMany({
        where: {
          projectId,
          status: { not: "SUPERSEDED" },
        },
        orderBy: [{ role: "asc" }, { storySceneId: "asc" }],
        select: {
          id: true,
          role: true,
          storySceneId: true,
          routingMode: true,
          treatment: true,
          status: true,
          userMessageKey: true,
          generatedAssetId: true,
          sourceMediaAssetId: true,
        },
      })
    ).filter((slot) => slotVisibleOnCut(timeline.payload, slot));
    if (slots.length === 0) {
      return [];
    }
    const attempts = await prisma.shotFulfillmentAttempt.findMany({
      where: { shotFulfillmentId: { in: slots.map((slot) => slot.id) } },
      orderBy: { attemptNo: "desc" },
      select: { shotFulfillmentId: true, attemptNo: true, outcome: true },
    });
    const latestOutcome = new Map<string, string>();
    for (const attempt of attempts) {
      if (!latestOutcome.has(attempt.shotFulfillmentId)) {
        latestOutcome.set(attempt.shotFulfillmentId, attempt.outcome);
      }
    }
    const assetIds = slots
      .map((slot) => slot.generatedAssetId)
      .filter((id): id is string => Boolean(id));
    const assets =
      assetIds.length === 0
        ? []
        : await prisma.generatedAsset.findMany({
            where: { projectId, id: { in: assetIds } },
            select: { id: true, status: true, sourceMediaAssetId: true, kind: true },
          });
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const placed = generatedAssetIdsInTimeline(timeline.payload);
    const views: SlotMessageView[] = [];
    for (const slot of slots) {
      const asset = slot.generatedAssetId ? assetsById.get(slot.generatedAssetId) : undefined;
      const state: AppliedSlotState = {
        role: slot.role,
        storySceneId: slot.storySceneId && slot.storySceneId.length > 0 ? slot.storySceneId : null,
        roleKind: presenterRoleKind(slot.role, asset?.kind ?? null),
        routingMode: slot.routingMode === "ENFORCED" ? "ENFORCED" : "LEGACY",
        treatment: slot.treatment,
        status: slot.status,
        userMessageKey: slot.userMessageKey,
        generatedAssetId: slot.generatedAssetId,
        sourceMediaAssetId: slot.sourceMediaAssetId,
        latestAttemptOutcome: latestOutcome.get(slot.id) ?? null,
        assetStatus: asset?.status ?? null,
        assetSourceMediaAssetId: asset?.sourceMediaAssetId ?? null,
        assetInProject: Boolean(asset),
        clipInTimeline: Boolean(slot.generatedAssetId && placed.has(slot.generatedAssetId)),
      };
      views.push(...presentSlotMessages(state));
    }
    return views;
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
    const routingMode = readSgRoutingMode();
    const registryLoad = this.loadRoutingRegistry();

    const userId = payload.requestedBy;
    const projectId = payload.projectId;
    const healthCache = new Map<string, Promise<boolean>>();
    await this.projects.getForUser(userId, projectId);
    const timeline = await this.requireReadyTimeline(projectId);
    if (timeline.id !== payload.timelineId || timeline.version !== payload.timelineVersion) {
      throw AppError.assetTimelineRequired(
        "The READY cut changed before missing pieces could be generated.",
      );
    }
    const story = await this.loadStory(timeline.storyStructureId);
    const sceneEmphasis = await loadSceneEmphasis(prisma, projectId, story);
    const assetIds: string[] = [];

    for (const role of payload.roles) {
      if (await this.isCancelled(job.id)) {
        return { cancelled: true, assetIds };
      }

      const kind = role.kind ?? inferKindFromRole(role.role);
      const cueInput = await this.collectCues(prisma, {
        projectId,
        story,
        timeline: timeline.document,
        role: role.role,
        storySceneId: role.storySceneId,
        sourceMediaAssetId: kind === "ENHANCEMENT" ? (role.sourceMediaAssetId ?? null) : null,
        sceneEmphasis,
      });
      const cues = persistableShotCues(extractShotCues(cueInput));
      const slot = await this.fulfillments.ensureSlot({
        projectId,
        timelineId: timeline.id,
        timelineVersion: timeline.version,
        role: role.role,
        storySceneId: role.storySceneId,
        sourceMediaAssetId: role.sourceMediaAssetId,
        cues,
      });

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
        await this.fulfillments.attachReadyAsset({
          shotFulfillmentId: slot.id,
          generatedAssetId: alreadyReady.id,
          jobId: job.id,
        });
        assetIds.push(alreadyReady.id);
        continue;
      }

      const route = await this.applyRoute({
        slotId: slot.id,
        extracted: cues,
        cueInput,
        routingMode,
        registryLoad,
        sentAssetId: kind === "ENHANCEMENT" ? (role.sourceMediaAssetId ?? null) : null,
        namedStillId: kind === "ENHANCEMENT" ? (role.sourceMediaAssetId ?? null) : null,
        clips: timeline.document.clips,
        jobId: job.id,
        userId,
        projectId,
        job,
        role: role.role,
        storySceneId: role.storySceneId,
        storedShotRole: slot.shotRole,
        storedIdentityState: slot.identityState,
        storedRequiredScopes: slot.requiredScopes,
        kind,
        healthCache,
      });
      if (route.kind === "skip") {
        if (route.stopJob) {
          break;
        }
        continue;
      }
      if (route.kind === "processor") {
        const processedId = await this.runKenBurns({
          route,
          slotId: slot.id,
          userId,
          projectId,
          job,
          role,
          timeline,
          story,
        });
        if (processedId) {
          assetIds.push(processedId);
        }
        continue;
      }
      const runtime = route.kind === "enforced" ? route.runtime : resolved;
      const releaseRouteHold = async () => {
        if (route.kind === "enforced") {
          await this.releaseHold(route.hold);
        }
      };
      if (!runtime) {
        await releaseRouteHold();
        throw AppError.providerNotConfigured("AssetGeneratorPort");
      }

      const capability = capabilityForKind(kind);
      if (!runtime.supportedCapabilities.includes(capability)) {
        await releaseRouteHold();
        const failed = await this.persistFailed({
          projectId,
          jobId: job.id,
          role,
          kind,
          timeline,
          capability,
          error: `No ready adapter can perform ${capability}.`,
        });
        await this.markSlotFailure(slot.id, projectId, job.id, failed.id);
        throw AppError.assetCapabilityUnavailable(capability);
      }

      let input;
      try {
        input = await this.contract.assembleInput(userId, projectId, timeline, role, story);
      } catch (error) {
        await releaseRouteHold();
        await this.markSlotFailure(slot.id, projectId, job.id);
        throw error;
      }
      const inputFingerprint = fingerprintAssetGeneratorInput(input);
      const startedAt = Date.now();
      logger.info("asset.started", { projectId, jobId: job.id, role: role.role, kind });

      const attribution = runtime.attributionFor(capability);
      let quote;
      try {
        quote =
          route.kind === "enforced"
            ? route.quote
            : this.legacyAttemptQuote(attribution.providerKey, attribution.modelId);
      } catch (error) {
        await releaseRouteHold();
        await this.markSlotFailure(slot.id, projectId, job.id);
        throw AppError.assetProviderUnavailable(
          error instanceof Error ? error.message : "AI video lane registry failed closed.",
        );
      }
      let budgetHold: AiVideoBudgetReservationRecord | null =
        route.kind === "enforced" ? route.hold : null;
      if (route.kind === "enforced" && !budgetHold) {
        await this.markSlotFailure(slot.id, projectId, job.id);
        throw AppError.assetProviderUnavailable(
          "ENFORCED generation requires an app hold from the routed lane.",
        );
      }
      try {
        if (route.kind !== "enforced") {
          budgetHold = await this.reserveProductionBudget({
            userId,
            projectId,
            job,
            role: role.role,
            storySceneId: role.storySceneId,
          });
        }
      } catch (error) {
        if (isAppError(error) && error.code === "SPEND_CAP_REACHED") {
          try {
            await this.recordClosedAttempt(slot.id, quote, job.id, error, null);
          } catch (markError) {
            this.logSlotMarkFailed(projectId, job.id, slot.id, markError);
          }
        } else {
          await this.markSlotFailure(slot.id, projectId, job.id);
        }
        throw error;
      }

      await this.fulfillments.abandonPendingAttempts({
        shotFulfillmentId: slot.id,
        jobId: job.id,
      });
      const attempt = await this.fulfillments.beginAttempt({
        shotFulfillmentId: slot.id,
        laneClass: quote.laneClass,
        laneId: quote.laneId,
        providerKey: quote.providerKey,
        modelId: quote.modelId,
        requiredScopes: route.requiredScopes,
        jobId: job.id,
        budgetReservationId: budgetHold?.id ?? null,
        estimatedBilledSeconds: quote.estimatedBilledSeconds,
        usdPerSecond: quote.usdPerSecond,
        estimatedUsd: quote.estimatedUsd,
      });

      let rawDocument;
      let reconciled: AiVideoBudgetReservationRecord | null = null;
      try {
        rawDocument = await runtime.adapter.generate(input);
        if (budgetHold) {
          reconciled = await this.reconcileBudget(budgetHold, rawDocument.durationMs);
        }
      } catch (error) {
        const mapped = attemptOutcomeFor(error);
        if (budgetHold) {
          await this.settleBudgetFailure(budgetHold, error);
          await this.rememberBudgetGatewayId(budgetHold, mapped.gatewayReservationId);
        }
        await this.recordAttemptFailure(attempt.id, error);
        this.logFulfillmentAttempt({
          projectId,
          jobId: job.id,
          slotKey: slot.slotKey,
          attemptNo: attempt.attemptNo,
          classAttemptNo: attempt.classAttemptNo,
          outcome: mapped.outcome,
          laneId: quote.laneId,
          providerKey: quote.providerKey,
          budgetReservationId: budgetHold?.id ?? null,
          gatewayReservationId: mapped.gatewayReservationId,
        });
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
      const trace = gatewayTraceFor(rawDocument);
      await this.rememberBudgetGatewayId(budgetHold, trace?.gatewayReservationId ?? null);
      let document;
      let stored;
      try {
        document = this.contract.validateDocument(input, rawDocument);
        await this.assertStoredBytes(document);
      } catch (error) {
        await this.fulfillments.finishAttempt({
          attemptId: attempt.id,
          outcome: "REJECTED_TECHNICAL",
          failureCode: isAppError(error) ? error.code : "REJECTED_TECHNICAL",
          budgetReservationId: budgetHold?.id ?? null,
          gatewayJobId: trace?.gatewayJobId ?? null,
          gatewayReservationId: trace?.gatewayReservationId ?? null,
          actualBilledSeconds: reconciled?.actualBilledSeconds ?? trace?.actualBilledSeconds ?? null,
          actualUsd: reconciled?.actualUsd ?? trace?.actualUsd ?? null,
        });
        this.logFulfillmentAttempt({
          projectId,
          jobId: job.id,
          slotKey: slot.slotKey,
          attemptNo: attempt.attemptNo,
          classAttemptNo: attempt.classAttemptNo,
          outcome: "REJECTED_TECHNICAL",
          laneId: quote.laneId,
          providerKey: quote.providerKey,
          budgetReservationId: budgetHold?.id ?? null,
          gatewayReservationId: trace?.gatewayReservationId ?? null,
        });
        throw error;
      }

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

      try {
        stored = await prisma.$transaction(async (tx) => {
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
      } catch (error) {
        await this.fulfillments.finishAttempt({
          attemptId: attempt.id,
          outcome: "FAILED",
          failureCode: isAppError(error) ? error.code : "PERSIST_FAILED",
          budgetReservationId: budgetHold?.id ?? null,
          gatewayJobId: trace?.gatewayJobId ?? null,
          gatewayReservationId: trace?.gatewayReservationId ?? null,
          actualBilledSeconds: reconciled?.actualBilledSeconds ?? trace?.actualBilledSeconds ?? null,
          actualUsd: reconciled?.actualUsd ?? trace?.actualUsd ?? null,
        });
        this.logFulfillmentAttempt({
          projectId,
          jobId: job.id,
          slotKey: slot.slotKey,
          attemptNo: attempt.attemptNo,
          classAttemptNo: attempt.classAttemptNo,
          outcome: "FAILED",
          laneId: quote.laneId,
          providerKey: quote.providerKey,
          budgetReservationId: budgetHold?.id ?? null,
          gatewayReservationId: trace?.gatewayReservationId ?? null,
        });
        throw error;
      }

      await this.fulfillments.finishAttempt({
        attemptId: attempt.id,
        outcome: "SUCCEEDED",
        failureCode: null,
        budgetReservationId: budgetHold?.id ?? null,
        gatewayJobId: trace?.gatewayJobId ?? null,
        gatewayReservationId: trace?.gatewayReservationId ?? null,
        actualBilledSeconds: reconciled?.actualBilledSeconds ?? trace?.actualBilledSeconds ?? null,
        actualUsd: reconciled?.actualUsd ?? trace?.actualUsd ?? null,
        generatedAssetId: stored.id,
        outputWidth: stored.width,
        outputHeight: stored.height,
      });
      this.logFulfillmentAttempt({
        projectId,
        jobId: job.id,
        slotKey: slot.slotKey,
        attemptNo: attempt.attemptNo,
        classAttemptNo: attempt.classAttemptNo,
        outcome: "SUCCEEDED",
        laneId: quote.laneId,
        providerKey: quote.providerKey,
        budgetReservationId: budgetHold?.id ?? null,
        gatewayReservationId: trace?.gatewayReservationId ?? null,
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
      throw AppError.spendCapReached(SG_COPY.SG_CAP_REACHED);
    }
    let lane;
    try {
      lane = requireLiveLane(laneId, registryPathFromEnv());
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
        throw AppError.spendCapReached(SG_COPY.SG_CAP_REACHED);
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
    return this.budgets.reconcile(hold.id, {
      actualBilledSeconds: actual.seconds,
      reason: actual.flagged ? "ACTUAL_DURATION_FALLBACK" : "SUCCEEDED",
    });
  }

  /**
   * Mirrors the gateway settlement carried on the adapter error.
   * A missing settlement stays counted (UNRECONCILED). Release only for an
   * explicit RELEASED, or for errors raised before the request was sent.
   */
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
    const settlement = appSettlementFor(error);
    if (settlement === "NONE") {
      await this.budgets.release(hold.id, "GATEWAY_NONE");
      return;
    }
    if (settlement === "RELEASED") {
      await this.budgets.release(hold.id, "GATEWAY_RELEASED");
      return;
    }
    if (settlement === "RECONCILED") {
      const reported = isAppError(error) ? error.details?.actualBilledSeconds : undefined;
      const actualBilledSeconds =
        typeof reported === "number" && Number.isFinite(reported) && reported >= 0
          ? reported
          : hold.estimatedBilledSeconds;
      await this.budgets.reconcile(hold.id, {
        actualBilledSeconds,
        reason: "GATEWAY_RECONCILED",
      });
      return;
    }
    await this.budgets.markUnreconciled(
      hold.id,
      settlement === "UNRECONCILED" ? "GATEWAY_UNRECONCILED" : "SETTLEMENT_MISSING",
    );
  }

  /**
   * A slot-marker failure must not replace the error the worker will classify.
   * A thrown marker used to turn a terminal AppError into a retryable job.
   */
  private async markSlotFailure(
    slotId: string,
    projectId: string,
    jobId: string,
    generatedAssetId?: string,
  ) {
    try {
      await this.fulfillments.markUnattemptedFailure(slotId, generatedAssetId);
    } catch (markError) {
      this.logSlotMarkFailed(projectId, jobId, slotId, markError);
    }
  }

  private logSlotMarkFailed(projectId: string, jobId: string, slotId: string, markError: unknown) {
    logger.warn("asset.slot_mark_failed", {
      projectId,
      jobId,
      slotId,
      error: markError instanceof Error ? markError.message : "unknown",
    });
  }

  private loadRoutingRegistry(): RoutingRegistryLoad {
    const file = registryPathFromEnv();
    try {
      const registry = loadSgLaneRegistry(file);
      const suspendedIds = suspendedLaneIdsFromEnv(process.env.SG_LANES_SUSPENDED);
      reportUnknownSuspendedLanes(registry, suspendedIds);
      return { ok: true, registry, suspendedIds, path: file };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lane registry is invalid.";
      reportLaneRegistryInvalid(file ?? DEFAULT_SG_LANE_REGISTRY_PATH, message);
      return { ok: false, path: file };
    }
  }

  /**
   * PR-8 decision for one role. Shadow is always the ENFORCED decision.
   * LEGACY generation stays on the injected adapter. forLane runs only for
   * an ENFORCED GENERATE lane that listEligibleLanes already returned.
   * An unreadable registry does not replace today's LEGACY quote failure.
   */
  private async applyRoute(input: {
    slotId: string;
    extracted: ReturnType<typeof persistableShotCues>;
    cueInput: ShotCueInput;
    routingMode: RoutingMode;
    registryLoad: RoutingRegistryLoad;
    sentAssetId: string | null;
    /** ENHANCEMENT source id only. Other kinds pass null so a still stays unproven. */
    namedStillId: string | null;
    clips: ReadonlyArray<{
      trackKey: string;
      sourceKind?: "MEDIA_ASSET" | "GENERATED_ASSET";
      assetId?: string;
      mediaRole?: string;
      storySceneId?: string;
      timelineStartMs: number;
      timelineEndMs: number;
    }>;
    jobId: string;
    userId: string;
    projectId: string;
    job: JobRecord;
    role: string;
    storySceneId?: string;
    storedShotRole: string | null;
    storedIdentityState: string;
    storedRequiredScopes: readonly string[];
    kind: GeneratedAssetKind;
    healthCache: Map<string, Promise<boolean>>;
  }): Promise<RoleRoute> {
    const hero =
      input.extracted.requiredScopes.includes("HERO") ||
      input.storedRequiredScopes.includes("HERO");
    const tightened = tightenIdentityForRoute({
      identityState: input.extracted.identityState,
      hero,
      analyzedAssetId: input.cueInput.analyzedAssetId ?? null,
      sentAssetId: input.sentAssetId,
      analysisRootKeys: input.cueInput.analysisRootKeys ?? null,
    });
    const routeIdentity = stricterIdentityState(input.storedIdentityState, tightened.identityState);
    const dialogueOutline = input.cueInput.scene?.dialogueOutline?.trim() ?? "";
    const dialogueCloseup =
      input.storedShotRole === "dialogue-closeup" ||
      (dialogueOutline.length > 0 && routeIdentity !== "ABSENT");
    const coverage = await this.loadSlotCoverage({
      projectId: input.projectId,
      role: input.role,
      storySceneId: input.storySceneId,
      namedStillId: input.namedStillId,
      clips: input.clips,
    });
    const cues: ShotCues = {
      requiredScopes: requiredScopesFor(routeIdentity, hero),
      shotRole: dialogueCloseup ? "dialogue-closeup" : input.extracted.shotRole,
      identityState: routeIdentity,
      originalCoversSlot: coverage.originalCoversSlot,
      sourceStillExists: coverage.sourceStillExists,
      motionNeed: input.extracted.motionNeed,
      routingMode: input.routingMode,
    };
    const rows = await this.fulfillments.listAttempts(input.slotId);
    const split = splitAttempts(rows);
    const blockingRows =
      input.routingMode === "LEGACY" ? rows.filter((row) => row.jobId === input.jobId) : rows;
    const rawBlocks = blockingRows.some((row) => {
      const outcome = attemptOutcomeSchema.safeParse(row.outcome);
      return outcome.success && blocksAutomaticPaidRetry(outcome.data, input.routingMode);
    });
    const snapshot = await this.routingSnapshot(
      input.registryLoad,
      input.routingMode,
      cues.requiredScopes,
      split.unclassified,
      input.healthCache,
    );
    const budget = await this.routingBudgetSnapshot(input.userId, input.projectId);
    let plan;
    try {
      plan = planRoute(
        cues,
        snapshot.snapshot,
        budget,
        split.attempts,
      );
    } catch {
      await this.recordSkip(input.slotId, input.routingMode, null, {
        treatment: "FAIL_HONEST",
        laneClass: null,
        laneId: null,
        providerKey: null,
        decisionReason: "Routing cues are outside the SG.0 contract.",
        messageKey: SG_MESSAGE_KEYS.FAILED_HONEST,
      });
      return { kind: "skip", stopJob: false, requiredScopes: cues.requiredScopes };
    }

    const forceLegacy =
      input.routingMode === "LEGACY" &&
      cues.shotRole !== "dialogue-closeup" &&
      !rawBlocks;

    let applied = plan.applied;
    if (forceLegacy) {
      applied = {
        treatment: "GENERATE",
        laneClass: "standard",
        laneId: "legacy",
        providerKey: "legacy",
        decisionReason: "LEGACY routes this role on the injected adapter.",
        messageKey: null,
      };
    } else if (applied.treatment === "GENERATE" && rawBlocks) {
      applied = {
        treatment: "DEFER",
        laneClass: null,
        laneId: null,
        providerKey: null,
        decisionReason:
          rows.some((row) => row.outcome === "CAP_DENIED")
            ? "A spend cap was reached. No automatic retry."
            : "No automatic retry after an unsettled or cancelled attempt.",
        messageKey: rows.some((row) => row.outcome === "CAP_DENIED")
          ? SG_MESSAGE_KEYS.CAP_REACHED
          : SG_MESSAGE_KEYS.FAILED_HONEST,
      };
    }

    if (
      input.routingMode === "ENFORCED" &&
      input.kind === "ENHANCEMENT" &&
      applied.treatment === "GENERATE" &&
      cues.shotRole !== "dialogue-closeup"
    ) {
      applied = enhancementProcessorDecision(coverage, cues.motionNeed);
    }

    if (applied.treatment === "KEN_BURNS" || applied.treatment === "STATIC") {
      if (input.kind === "IMAGE") {
        await this.recordSkip(
          input.slotId,
          input.routingMode,
          plan.shadow,
          honest("IMAGE has no enhancement lane."),
        );
        return { kind: "skip", stopJob: false, requiredScopes: cues.requiredScopes };
      }
      if (cues.shotRole === "dialogue-closeup") {
        await this.recordSkip(input.slotId, input.routingMode, plan.shadow, {
          treatment: "DEFER",
          laneClass: null,
          laneId: null,
          providerKey: null,
          decisionReason: "Dialogue close-up is not generated while E12 is open.",
          messageKey: SG_MESSAGE_KEYS.WAITING,
        });
        return { kind: "skip", stopJob: false, requiredScopes: cues.requiredScopes };
      }
      const prepared = await this.prepareKenBurns({
        treatment: applied.treatment,
        coverage,
        slotDurationMs: input.extracted.slotDurationMs,
        projectId: input.projectId,
      });
      if (!prepared) {
        await this.recordSkip(
          input.slotId,
          input.routingMode,
          plan.shadow,
          honest("The Ken Burns processor is not configured for this slot."),
        );
        return { kind: "skip", stopJob: false, requiredScopes: cues.requiredScopes };
      }
      return {
        kind: "processor",
        requiredScopes: cues.requiredScopes,
        shadow: plan.shadow,
        applied,
        params: prepared,
      };
    }

    if (applied.treatment !== "GENERATE") {
      const stopJob =
        applied.messageKey === SG_MESSAGE_KEYS.CAP_REACHED &&
        (plan.stopJob || rows.some((row) => row.outcome === "CAP_DENIED"));
      await this.recordSkip(input.slotId, input.routingMode, plan.shadow, applied);
      return { kind: "skip", stopJob, requiredScopes: cues.requiredScopes };
    }

    if (input.routingMode === "LEGACY") {
      const guard = legacyModelGuard({
        assetHttpModel: process.env.ASSET_HTTP_MODEL,
        registryModelId: snapshot.available ? plan.legacyModelId : null,
      });
      await this.recordShadow(
        input.slotId,
        input.routingMode,
        plan.shadow,
        "LEGACY routes this role on the injected adapter.",
        { treatment: "GENERATE", userMessageKey: null },
      );
      if (!guard.ok) {
        void reportOpsAlert({
          kind: OpsAlertKind.SG_MODEL_LANE_MISMATCH,
          message: guard.reason,
        });
        await this.recordSkip(input.slotId, input.routingMode, plan.shadow, {
          treatment: "FAIL_HONEST",
          laneClass: null,
          laneId: null,
          providerKey: null,
          decisionReason: guard.reason,
          messageKey: SG_MESSAGE_KEYS.FAILED_HONEST,
        });
        return { kind: "skip", stopJob: false, requiredScopes: cues.requiredScopes };
      }
      return { kind: "legacy", requiredScopes: cues.requiredScopes };
    }

    const enforced = await this.prepareEnforcedGenerate({
      slotId: input.slotId,
      routingMode: input.routingMode,
      shadow: plan.shadow,
      applied,
      registryLoad: input.registryLoad,
      requiredScopes: cues.requiredScopes,
      userId: input.userId,
      projectId: input.projectId,
      job: input.job,
      role: input.role,
      storySceneId: input.storySceneId,
      kind: input.kind,
    });
    return enforced;
  }

  private async routingBudgetSnapshot(userId: string, projectId: string): Promise<BudgetSnapshot> {
    const resolved = AiVideoBudgetSource.resolve(userId, projectId);
    const [project, user] = await Promise.all([
      this.budgets.snapshot(projectBudgetLedgerId(projectId)),
      this.budgets.snapshot(userWindowBudgetLedgerId(userId, resolved.windowKey)),
    ]);
    return {
      projectBlocked: ledgerCapBlocked(
        project,
        resolved.caps.projectMaxSeconds,
        resolved.caps.projectMaxUsd,
      ),
      userBlocked: ledgerCapBlocked(
        user,
        resolved.caps.userWindowMaxSeconds,
        resolved.caps.userWindowMaxUsd,
      ),
      // Gateway spend ledgers yf-asset and lane:<laneId> enforce global and per-lane
      // caps at gateway reserve. A read-side pre-check is a PR-11 carry.
      globalBlocked: false,
      laneBlocked: false,
    };
  }

  private async routingSnapshot(
    load: RoutingRegistryLoad,
    mode: RoutingMode,
    requiredScopes: ShotCues["requiredScopes"],
    unclassifiedAttemptCount: number,
    healthCache: Map<string, Promise<boolean>>,
  ): Promise<{ available: boolean; snapshot: RegistrySnapshot }> {
    if (!load.ok) {
      return {
        available: false,
        snapshot: { lanes: [], registryUnavailable: true, unclassifiedAttemptCount },
      };
    }
    const lanes = applyLaneSuspension(load.registry.lanes, load.suspendedIds);
    const health = new Map<string, boolean>();
    if (mode === "ENFORCED") {
      const eligible = listEligibleLanes({
        requiredScopes,
        path: load.path,
        registry: load.registry,
        suspendedLaneIds: load.suspendedIds,
      });
      const probed = await probeEligibleLaneHealth(
        eligible.map((lane) => ({
          laneId: lane.laneId,
          baseUrl: readLaneHealthBaseUrl(lane, process.env),
        })),
        (baseUrl) => this.probeHealth(baseUrl),
        healthCache,
      );
      for (const [laneId, ok] of probed) {
        health.set(laneId, ok);
      }
    }
    return {
      available: true,
      snapshot: {
        ...snapshotFromLanes(lanes, load.registry, health),
        unclassifiedAttemptCount,
      },
    };
  }

  private async prepareEnforcedGenerate(input: {
    slotId: string;
    routingMode: RoutingMode;
    shadow: RouteDecision;
    applied: RouteDecision;
    registryLoad: RoutingRegistryLoad;
    requiredScopes: string[];
    userId: string;
    projectId: string;
    job: JobRecord;
    role: string;
    storySceneId?: string;
    kind: GeneratedAssetKind;
  }): Promise<RoleRoute> {
    if (input.applied.treatment !== "GENERATE" || !input.registryLoad.ok) {
      await this.recordSkip(input.slotId, input.routingMode, input.shadow, honest("No eligible lane for the required scopes."));
      return { kind: "skip", stopJob: false, requiredScopes: input.requiredScopes };
    }
    const roleCapability = capabilityForKind(input.kind);
    if (!GENERATIVE_LANE_CAPABILITIES.some((item) => item === roleCapability)) {
      await this.recordSkip(
        input.slotId,
        input.routingMode,
        input.shadow,
        honest(`No ready adapter can perform ${roleCapability}.`),
      );
      return { kind: "skip", stopJob: false, requiredScopes: input.requiredScopes };
    }
    const eligible = listEligibleLanes({
      requiredScopes: input.requiredScopes,
      path: input.registryLoad.path,
      registry: input.registryLoad.registry,
      suspendedLaneIds: input.registryLoad.suspendedIds,
    });
    try {
      assertEnforcedLaneCallable({
        laneId: input.applied.laneId,
        eligibleLaneIds: eligible.map((lane) => lane.laneId),
        decision: input.applied,
      });
    } catch {
      await this.recordSkip(input.slotId, input.routingMode, input.shadow, honest("No eligible lane for the required scopes."));
      return { kind: "skip", stopJob: false, requiredScopes: input.requiredScopes };
    }
    const lane = input.registryLoad.registry.lanes.find((item) => item.laneId === input.applied.laneId);
    let quote: AttemptQuote;
    try {
      if (!lane) {
        throw new Error("missing lane");
      }
      const charge = estimateLaneCharge(lane);
      quote = {
        laneId: lane.laneId,
        laneClass: lane.laneClass,
        providerKey: lane.providerKey,
        modelId: lane.modelId,
        estimatedBilledSeconds: charge.estimatedBilledSeconds,
        usdPerSecond: lane.usdPerSecond,
        estimatedUsd: charge.reservedUsd,
      };
    } catch {
      await this.recordSkip(input.slotId, input.routingMode, input.shadow, honest("The eligible lane has no price."));
      return { kind: "skip", stopJob: false, requiredScopes: input.requiredScopes };
    }
    let hold: AiVideoBudgetReservationRecord | null = null;
    try {
      hold = await this.reserveRoutedLane({
        userId: input.userId,
        projectId: input.projectId,
        job: input.job,
        role: input.role,
        storySceneId: input.storySceneId,
        quote,
      });
    } catch (error) {
      if (isAppError(error) && error.code === "SPEND_CAP_REACHED") {
        try {
          await this.recordClosedAttempt(input.slotId, quote, input.job.id, error, null);
        } catch (markError) {
          this.logSlotMarkFailed(input.projectId, input.job.id, input.slotId, markError);
        }
      } else {
        await this.markSlotFailure(input.slotId, input.projectId, input.job.id);
      }
      throw error;
    }
    if (!hold) {
      await this.recordSkip(
        input.slotId,
        input.routingMode,
        input.shadow,
        honest("ENFORCED generation requires an app hold from the routed lane."),
      );
      return { kind: "skip", stopJob: false, requiredScopes: input.requiredScopes };
    }
    const resolver = this.resolveLanes();
    if (!resolver) {
      await this.releaseHold(hold);
      await this.recordSkip(input.slotId, input.routingMode, input.shadow, honest("No lane resolver is configured."));
      return { kind: "skip", stopJob: false, requiredScopes: input.requiredScopes };
    }
    let resolvedLane;
    try {
      resolvedLane = resolver.forLane(input.applied.laneId);
    } catch {
      await this.releaseHold(hold);
      await this.recordSkip(input.slotId, input.routingMode, input.shadow, honest("The eligible lane could not be resolved."));
      return { kind: "skip", stopJob: false, requiredScopes: input.requiredScopes };
    }
    const capability = resolvedLane.supportedCapabilities[0];
    const attribution = capability ? resolvedLane.attribution(capability) : null;
    if (!lane || !capability || !attribution || attribution.modelId !== lane.modelId) {
      await this.releaseHold(hold);
      void reportOpsAlert({
        kind: OpsAlertKind.SG_MODEL_LANE_MISMATCH,
        message: "Resolved modelId does not match the registry lane modelId.",
      });
      await this.recordSkip(input.slotId, input.routingMode, input.shadow, honest("The lane model does not match the registry."));
      return { kind: "skip", stopJob: false, requiredScopes: input.requiredScopes };
    }
    quote = { ...quote, modelId: attribution.modelId };
    await this.recordShadow(
      input.slotId,
      input.routingMode,
      input.shadow,
      input.applied.decisionReason,
      { treatment: "GENERATE", userMessageKey: null },
    );
    return {
      kind: "enforced",
      requiredScopes: input.requiredScopes,
      quote,
      hold,
      runtime: {
        adapter: resolvedLane.adapter,
        attributionFor: (cap) => resolvedLane.attribution(cap),
        supportedCapabilities: [...resolvedLane.supportedCapabilities],
      },
    };
  }

  /**
   * ENFORCED hold. Priced and labelled from the routed quote.
   * Does not read YF_GATEWAY_LANE_ID. A missing quote never reaches here.
   */
  private async reserveRoutedLane(input: {
    userId: string;
    projectId: string;
    job: JobRecord;
    role: string;
    storySceneId?: string;
    quote: AttemptQuote;
  }): Promise<AiVideoBudgetReservationRecord | null> {
    const resolved = AiVideoBudgetSource.resolve(input.userId, input.projectId);
    try {
      return await this.budgets.reserve({
        idempotencyKey: `asset:${input.job.id}:${input.role}:${input.storySceneId ?? "-"}:${input.job.attempts}`,
        projectId: input.projectId,
        userId: input.userId,
        windowKey: resolved.windowKey,
        laneId: input.quote.laneId,
        providerKey: input.quote.providerKey,
        estimatedBilledSeconds: input.quote.estimatedBilledSeconds,
        usdPerSecond: input.quote.usdPerSecond,
        estimatedUsd: input.quote.estimatedUsd,
        caps: resolved.caps,
      });
    } catch (error) {
      if (error instanceof AiVideoBudgetCapError) {
        logger.info("asset.cap_denied", {
          settleReason: "CAP_DENIED",
          userId: input.userId,
          projectId: input.projectId,
          jobId: input.job.id,
          laneId: input.quote.laneId,
          message: error.message,
        });
        throw AppError.spendCapReached(SG_COPY.SG_CAP_REACHED);
      }
      throw error;
    }
  }

  private async releaseHold(hold: AiVideoBudgetReservationRecord | null) {
    if (!hold) {
      return;
    }
    await this.budgets.release(hold.id, "GATEWAY_NONE");
  }

  private async recordShadow(
    slotId: string,
    routingMode: RoutingMode,
    shadow: RouteDecision,
    decisionReason?: string,
    display?: { treatment: "GENERATE"; userMessageKey: null },
  ) {
    await this.fulfillments.recordRouteDecision({
      shotFulfillmentId: slotId,
      routingMode,
      shadowDecision: shadow as Prisma.InputJsonValue,
      ...(decisionReason !== undefined ? { decisionReason } : {}),
      ...(display
        ? { treatment: display.treatment, userMessageKey: display.userMessageKey }
        : {}),
    });
  }

  /**
   * originalCoversSlot: one READY VIDEO MediaAsset clip on video.primary for this
   * role and scene, whose durationMs covers the clip span. Anything else is false.
   * sourceStillExists: one READY PHOTO (image/*) that is either the ENHANCEMENT
   * source id or the single MEDIA_ASSET clip for this role. A VIDEO_CLIP
   * sourceMediaAssetId is ignored. Disagreeing ids stay false.
   */
  private async loadSlotCoverage(input: {
    projectId: string;
    role: string;
    storySceneId?: string | null;
    namedStillId: string | null;
    clips: Parameters<AssetService["applyRoute"]>[0]["clips"];
  }): Promise<SlotCoverage> {
    const clipIds = input.clips
      .filter((clip) => clip.trackKey === "video.primary" && clip.mediaRole === input.role)
      .map((clip) => clip.assetId)
      .filter((id): id is string => Boolean(id));
    const ids = [...new Set([...(input.namedStillId ? [input.namedStillId] : []), ...clipIds])];
    let assets: CoverageAsset[] = [];
    if (ids.length > 0) {
      const rows = await prisma.mediaAsset.findMany({
        where: { projectId: input.projectId, id: { in: ids } },
        select: { id: true, kind: true, mimeType: true, status: true, durationMs: true },
      });
      assets = rows;
    }
    const coverage = deriveSlotCoverage({
      role: input.role,
      storySceneId: input.storySceneId,
      namedStillId: input.namedStillId,
      clips: input.clips,
      assets,
    });
    if (!coverage.sourceStillId) {
      return coverage;
    }
    const pan = await this.panForStill(coverage.sourceStillId);
    return { ...coverage, ...pan };
  }

  private async panForStill(assetId: string): Promise<Pick<SlotCoverage, "panX" | "panY" | "panAnchor">> {
    const center = { panX: 0.5, panY: 0.5, panAnchor: "center" as const };
    const rows = await prisma.mediaAnalysis.findMany({
      where: { assetId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      select: { payload: true, createdAt: true, status: true },
    });
    const latest = rows[0];
    if (!latest || latest.status !== "COMPLETED") {
      return center;
    }
    const previous = rows[1];
    if (previous && latest.createdAt.getTime() === previous.createdAt.getTime()) {
      return center;
    }
    return panAnchorFromAnalysis(latest.payload);
  }

  private async projectOutputProfile(projectId: string): Promise<RenderOutputProfile> {
    const row = await prisma.renderJob.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const payload = row?.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return DEFAULT_RENDER_OUTPUT_PROFILE;
    }
    const manifest = (payload as { manifest?: { outputProfile?: unknown } }).manifest;
    const value = manifest?.outputProfile;
    if (typeof value === "string" && (RENDER_OUTPUT_PROFILES as readonly string[]).includes(value)) {
      return value as RenderOutputProfile;
    }
    return DEFAULT_RENDER_OUTPUT_PROFILE;
  }

  private async prepareKenBurns(input: {
    treatment: "KEN_BURNS" | "STATIC";
    coverage: SlotCoverage;
    slotDurationMs: number | null;
    projectId: string;
  }): Promise<KenBurnsTreatmentParams | null> {
    if (!input.coverage.sourceStillExists || !input.coverage.sourceStillId) {
      return null;
    }
    const resolver = this.resolveLanes();
    const hook = resolver
      ?.processors(AssetCapability.MEDIA_ENHANCEMENT)
      .find(
        (processor) =>
          processor.laneId === KEN_BURNS_PROVIDER_KEY &&
          processor.providerKey === KEN_BURNS_PROVIDER_KEY &&
          processor.adapter &&
          isKenBurnsProcessor(processor.adapter),
      );
    if (!hook) {
      return null;
    }
    const outputProfile = await this.projectOutputProfile(input.projectId);
    return buildKenBurnsParams({
      treatment: input.treatment,
      sourceMediaAssetId: input.coverage.sourceStillId,
      slotDurationMs: input.slotDurationMs,
      panX: input.coverage.panX,
      panY: input.coverage.panY,
      panAnchor: input.coverage.panAnchor,
      outputProfile,
    });
  }

  /**
   * Processor path. No forLane, no hold, no paid attempt, no Timeline write.
   * The clip is a GeneratedAsset the user includes with an explicit Rebuild cut.
   */
  private async runKenBurns(input: {
    route: Extract<RoleRoute, { kind: "processor" }>;
    slotId: string;
    userId: string;
    projectId: string;
    job: JobRecord;
    role: AssetRoleRequest;
    timeline: ReadyTimelineSource;
    story: Awaited<ReturnType<AssetService["loadStory"]>>;
  }): Promise<string | null> {
    const resolver = this.resolveLanes();
    const hook = resolver
      ?.processors(AssetCapability.MEDIA_ENHANCEMENT)
      .find((processor) => processor.adapter && isKenBurnsProcessor(processor.adapter));
    const processor = hook?.adapter && isKenBurnsProcessor(hook.adapter) ? hook.adapter : null;
    if (!processor) {
      await this.recordSkip(
        input.slotId,
        readSgRoutingMode(),
        input.route.shadow,
        honest("The Ken Burns processor is not configured for this slot."),
      );
      return null;
    }
    const still = await prisma.mediaAsset.findFirst({
      where: { id: input.route.params.sourceMediaAssetId, projectId: input.projectId, status: "READY" },
      select: { storageKey: true },
    });
    const storedStill = still ? await this.storage.get(still.storageKey) : null;
    if (!storedStill || storedStill.body.byteLength === 0) {
      await this.recordSkip(
        input.slotId,
        readSgRoutingMode(),
        input.route.shadow,
        honest("The source still is not in storage."),
      );
      return null;
    }
    let document: GeneratedAssetDocument;
    let inputFingerprint: string;
    try {
      const assembled = await this.contract.assembleInput(
        input.userId,
        input.projectId,
        input.timeline,
        {
          role: input.role.role,
          storySceneId: input.role.storySceneId,
          kind: "ENHANCEMENT",
          sourceMediaAssetId: input.route.params.sourceMediaAssetId,
          reason: input.role.reason,
        },
        input.story,
      );
      const raw = await processor.process({
        ...input.route.params,
        projectId: input.projectId,
        role: input.role.role,
        storySceneId: input.role.storySceneId,
        timelineId: input.timeline.id,
        timelineVersion: input.timeline.version,
        storyStructureId: input.timeline.storyStructureId,
        storyStructureVersion: input.timeline.storyStructureVersion,
        stillBytes: storedStill.body,
      });
      document = this.contract.validateDocument(assembled, raw);
      await this.assertStoredBytes(document);
      inputFingerprint = fingerprintAssetGeneratorInput(assembled);
    } catch (error) {
      logger.warn("asset.kenburns_failed", {
        projectId: input.projectId,
        jobId: input.job.id,
        role: input.role.role,
        error: error instanceof Error ? error.message : "unknown",
      });
      await this.recordSkip(
        input.slotId,
        readSgRoutingMode(),
        input.route.shadow,
        honest("The Ken Burns processor could not write a clip."),
      );
      return null;
    }
    const priorReady = await prisma.generatedAsset.findFirst({
      where: {
        projectId: input.projectId,
        timelineId: input.timeline.id,
        role: input.role.role,
        status: GeneratedAssetStatus.READY,
        ...(input.role.storySceneId ? { storySceneId: input.role.storySceneId } : {}),
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
      const body = await this.storage.get(document.storageKey);
      return tx.generatedAsset.create({
        data: {
          projectId: input.projectId,
          status: GeneratedAssetStatus.READY,
          kind: document.kind,
          origin: document.origin,
          role: document.role,
          mimeType: document.mimeType,
          byteSize: BigInt(body?.body.byteLength ?? 0),
          storageKey: document.storageKey,
          durationMs: document.durationMs ?? null,
          width: document.width ?? null,
          height: document.height ?? null,
          checksum: document.checksum ?? null,
          payload: document as Prisma.InputJsonValue,
          jobId: input.job.id,
          inputFingerprint,
          providerKey: KEN_BURNS_PROVIDER_KEY,
          capability: AssetCapability.MEDIA_ENHANCEMENT,
          modelId: KEN_BURNS_PROVIDER_KEY,
          timelineId: input.timeline.id,
          timelineVersion: input.timeline.version,
          storySceneId: document.fulfillment.storySceneId ?? input.role.storySceneId ?? null,
          storyStructureId: input.timeline.storyStructureId,
          storyStructureVersion: input.timeline.storyStructureVersion,
          sourceMediaAssetId: document.sourceMediaAssetId ?? null,
          replacesAssetId: priorReady?.id ?? null,
        },
      });
    });
    await this.attribution.record({
      projectId: input.projectId,
      generatedAssetId: stored.id,
      jobId: input.job.id,
      providerKey: KEN_BURNS_PROVIDER_KEY,
      capability: AssetCapability.MEDIA_ENHANCEMENT,
      modelId: KEN_BURNS_PROVIDER_KEY,
    });
    await this.fulfillments.recordRouteDecision({
      shotFulfillmentId: input.slotId,
      routingMode: readSgRoutingMode(),
      shadowDecision: input.route.shadow as Prisma.InputJsonValue,
      decisionReason: input.route.applied.decisionReason,
      userMessageKey: input.route.applied.messageKey,
      treatment: input.route.applied.treatment,
      status: fulfillmentStatusForTreatment(input.route.applied.treatment) ?? "FALLBACK",
      treatmentParams: input.route.params as Prisma.InputJsonValue,
      generatedAssetId: stored.id,
      sourceMediaAssetId: input.route.params.sourceMediaAssetId,
    });
    logger.info("asset.kenburns_completed", {
      projectId: input.projectId,
      jobId: input.job.id,
      generatedAssetId: stored.id,
      role: input.role.role,
    });
    return stored.id;
  }

  private async recordSkip(
    slotId: string,
    routingMode: RoutingMode,
    shadow: RouteDecision | null,
    applied: RouteDecision,
  ) {
    const status = fulfillmentStatusForTreatment(applied.treatment) ?? "FAILED";
    await this.fulfillments.recordRouteDecision({
      shotFulfillmentId: slotId,
      routingMode,
      shadowDecision: (shadow ?? applied) as Prisma.InputJsonValue,
      decisionReason: applied.decisionReason,
      userMessageKey: applied.messageKey,
      treatment: applied.treatment,
      status,
    });
  }

  /**
   * Price label for the existing single-lane path. Local and unconfigured
   * runs record zeros and laneClass "unclassified", a recording label only.
   */
  private legacyAttemptQuote(providerKey: string, modelId: string | null) {
    if (!this.availability().productionAvailable) {
      return unpricedQuote(providerKey, providerKey, modelId);
    }
    const laneId = process.env.YF_GATEWAY_LANE_ID?.trim();
    if (!laneId) {
      return unpricedQuote("unconfigured", "unconfigured", modelId);
    }
    const lane = requireLiveLane(laneId, registryPathFromEnv());
    const charge = estimateLaneCharge(lane);
    return {
      laneId: lane.laneId,
      laneClass: lane.laneClass,
      providerKey: lane.providerKey,
      modelId,
      estimatedBilledSeconds: charge.estimatedBilledSeconds,
      usdPerSecond: lane.usdPerSecond,
      estimatedUsd: charge.reservedUsd,
    };
  }

  private async recordClosedAttempt(
    shotFulfillmentId: string,
    quote: ReturnType<AssetService["legacyAttemptQuote"]>,
    jobId: string,
    error: unknown,
    budgetReservationId: string | null,
  ) {
    const slot = await prisma.shotFulfillment.findUniqueOrThrow({
      where: { id: shotFulfillmentId },
      select: { requiredScopes: true, projectId: true, slotKey: true },
    });
    await this.fulfillments.abandonPendingAttempts({ shotFulfillmentId, jobId });
    const attempt = await this.fulfillments.beginAttempt({
      shotFulfillmentId,
      laneClass: quote.laneClass,
      laneId: quote.laneId,
      providerKey: quote.providerKey,
      modelId: quote.modelId,
      requiredScopes: slot.requiredScopes,
      jobId,
      budgetReservationId,
      estimatedBilledSeconds: quote.estimatedBilledSeconds,
      usdPerSecond: quote.usdPerSecond,
      estimatedUsd: quote.estimatedUsd,
    });
    const mapped = attemptOutcomeFor(error);
    await this.recordAttemptFailure(attempt.id, error);
    this.logFulfillmentAttempt({
      projectId: slot.projectId,
      jobId,
      slotKey: slot.slotKey,
      attemptNo: attempt.attemptNo,
      classAttemptNo: attempt.classAttemptNo,
      outcome: mapped.outcome,
      laneId: quote.laneId,
      providerKey: quote.providerKey,
      budgetReservationId,
      gatewayReservationId: mapped.gatewayReservationId,
    });
  }

  private logFulfillmentAttempt(input: {
    projectId: string;
    jobId: string;
    slotKey: string;
    attemptNo: number;
    classAttemptNo: number;
    outcome: string;
    laneId: string;
    providerKey: string;
    budgetReservationId: string | null;
    gatewayReservationId: string | null;
  }) {
    logger.info("asset.fulfillment_attempt", {
      projectId: input.projectId,
      jobId: input.jobId,
      slotKey: input.slotKey,
      attemptNo: input.attemptNo,
      classAttemptNo: input.classAttemptNo,
      outcome: input.outcome,
      laneId: input.laneId,
      providerKey: input.providerKey,
      budgetReservationId: input.budgetReservationId,
      gatewayReservationId: input.gatewayReservationId,
    });
  }

  private async rememberBudgetGatewayId(
    hold: AiVideoBudgetReservationRecord | null,
    gatewayReservationId: string | null,
  ) {
    if (!hold || !gatewayReservationId || hold.gatewayReservationId) {
      return;
    }
    await this.budgets.rememberGatewayReservationId(hold.id, gatewayReservationId);
  }

  private async recordAttemptFailure(attemptId: string, error: unknown) {
    const mapped = attemptOutcomeFor(error);
    await this.fulfillments.finishAttempt({
      attemptId,
      outcome: mapped.outcome,
      failureCode: mapped.failureCode,
      gatewayJobId: mapped.gatewayJobId,
      gatewayReservationId: mapped.gatewayReservationId,
      actualBilledSeconds: mapped.actualBilledSeconds,
      actualUsd: mapped.actualUsd,
    });
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
    return prisma.generatedAsset.create({
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

function unpricedQuote(laneId: string, providerKey: string, modelId: string | null) {
  return {
    laneId,
    laneClass: UNCLASSIFIED_LANE_CLASS,
    providerKey,
    modelId,
    estimatedBilledSeconds: 0,
    usdPerSecond: 0,
    estimatedUsd: 0,
  };
}

function attemptOutcomeFor(error: unknown) {
  const details = isAppError(error) ? error.details : undefined;
  const settlement = appSettlementFor(error);
  const settleReason = typeof details?.settleReason === "string" ? details.settleReason : null;
  const gatewayStatus = typeof details?.gatewayStatus === "number" ? details.gatewayStatus : null;
  const gatewayCode = typeof details?.gatewayCode === "string" ? details.gatewayCode : null;
  const mapped = attemptOutcomeFromSettlement({
    spendCap: isAppError(error) && error.code === "SPEND_CAP_REACHED",
    settlement,
    settleReason,
    gatewayStatus,
    gatewayCode,
  });
  return {
    ...mapped,
    gatewayReservationId:
      typeof details?.gatewayReservationId === "string" ? details.gatewayReservationId : null,
    gatewayJobId: typeof details?.gatewayJobId === "string" ? details.gatewayJobId : null,
    actualBilledSeconds: finiteDetail(details?.actualBilledSeconds),
    actualUsd: finiteDetail(details?.actualUsd),
  };
}

function finiteDetail(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function appSettlementFor(
  error: unknown,
): "RELEASED" | "RECONCILED" | "UNRECONCILED" | "NONE" | "MISSING" {
  if (!isAppError(error)) {
    return "MISSING";
  }
  if (error.code === "ASSET_CAPABILITY_UNAVAILABLE") {
    return "RELEASED";
  }
  if (
    error.code === "ASSET_PROVIDER_UNAVAILABLE" &&
    /No production asset generator adapter is configured/i.test(error.message)
  ) {
    return "RELEASED";
  }
  const settlement = error.details?.settlement;
  if (
    settlement === "RELEASED" ||
    settlement === "RECONCILED" ||
    settlement === "UNRECONCILED" ||
    settlement === "NONE"
  ) {
    return settlement;
  }
  return "MISSING";
}

type RoutingRegistryLoad =
  | { ok: false; path: string | undefined }
  | { ok: true; registry: SgLaneRegistry; suspendedIds: string[]; path: string | undefined };

type AttemptQuote = {
  laneId: string;
  laneClass: string;
  providerKey: string;
  modelId: string | null;
  estimatedBilledSeconds: number;
  usdPerSecond: number;
  estimatedUsd: number;
};

type RoleRoute =
  | { kind: "skip"; stopJob: boolean; requiredScopes: string[] }
  | { kind: "legacy"; requiredScopes: string[] }
  | {
      kind: "processor";
      requiredScopes: string[];
      shadow: RouteDecision;
      applied: RouteDecision;
      params: KenBurnsTreatmentParams;
    }
  | {
      kind: "enforced";
      requiredScopes: string[];
      quote: AttemptQuote;
      hold: AiVideoBudgetReservationRecord | null;
      runtime: ResolvedAssetRuntime;
    };

function ledgerCapBlocked(
  row: { reservedSeconds: number; committedSeconds: number; reservedUsd: number; committedUsd: number } | null,
  maxSeconds: number | undefined,
  maxUsd: number | undefined,
): boolean {
  if (!row) {
    return false;
  }
  const seconds = row.reservedSeconds + row.committedSeconds;
  const usd = row.reservedUsd + row.committedUsd;
  if (maxSeconds !== undefined && seconds >= maxSeconds) {
    return true;
  }
  if (maxUsd !== undefined && usd >= maxUsd) {
    return true;
  }
  return false;
}

function enhancementProcessorDecision(
  coverage: SlotCoverage,
  motionNeed: ShotCues["motionNeed"],
): RouteDecision {
  if (!coverage.sourceStillExists) {
    return honest("No source still for MEDIA_ENHANCEMENT.");
  }
  const treatment = motionNeed === "none" ? "STATIC" : "KEN_BURNS";
  return {
    treatment,
    laneClass: null,
    laneId: null,
    providerKey: null,
    decisionReason: "ENHANCEMENT uses the Ken Burns processor, not a generative lane.",
    messageKey:
      treatment === "STATIC" ? SG_MESSAGE_KEYS.FALLBACK_STATIC : SG_MESSAGE_KEYS.FALLBACK_KEN_BURNS,
  };
}

function honest(decisionReason: string): RouteDecision {
  return {
    treatment: "FAIL_HONEST",
    laneClass: null,
    laneId: null,
    providerKey: null,
    decisionReason,
    messageKey: SG_MESSAGE_KEYS.FAILED_HONEST,
  };
}

function splitAttempts(rows: readonly { laneClass: string; outcome: string; classAttemptNo: number }[]): {
  attempts: AttemptSoFar[];
  unclassified: number;
} {
  const attempts: AttemptSoFar[] = [];
  let unclassified = 0;
  for (const row of rows) {
    const laneClass = laneClassSchema.safeParse(row.laneClass);
    const outcome = attemptOutcomeSchema.safeParse(row.outcome);
    if (!laneClass.success || !outcome.success || !Number.isInteger(row.classAttemptNo) || row.classAttemptNo < 1) {
      unclassified += 1;
      continue;
    }
    attempts.push({
      laneClass: laneClass.data,
      outcome: outcome.data,
      classAttemptNo: row.classAttemptNo,
    });
  }
  return { attempts, unclassified };
}

function snapshotFromLanes(
  lanes: readonly RegistryLane[],
  registry: SgLaneRegistry,
  health: ReadonlyMap<string, boolean>,
): RegistrySnapshot {
  return {
    lanes: lanes.map((lane) => ({
      laneId: lane.laneId,
      laneClass: lane.laneClass,
      providerKey: lane.providerKey,
      enabled: lane.enabled,
      healthy: health.get(lane.laneId) ?? false,
      designation: lane.designation === "LEGACY_R1" ? "LEGACY_R1" : "NONE",
      resolutionTier: lane.resolutionTier,
      modelId: lane.modelId,
      gates: {
        HERO: lane.gates.HERO.status,
        IDENTITY: lane.gates.IDENTITY.status,
        NON_IDENTITY: lane.gates.NON_IDENTITY.status,
      },
    })),
    regenCeilings: registry.regenCeilings,
    classOrder: [...registry.classOrder],
  };
}

function registryPathFromEnv(): string | undefined {
  const path = process.env.SG_LANE_REGISTRY_PATH?.trim();
  return path ? path : undefined;
}

function presenterRoleKind(role: string, assetKind: string | null): PresenterRoleKind {
  if (assetKind && isGeneratedAssetKind(assetKind)) {
    return assetKind;
  }
  return inferKindFromRole(role);
}

function sceneKey(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}

/**
 * DEFERRED and FAILED slots stay visible only while that role and scene are
 * still unmet. An ORIGINAL fallback stays visible while it is unmet, or while
 * the cut has a MEDIA_ASSET clip for that role and scene. When the slot names
 * a source media id, that clip's asset must be the same id. Any other clip
 * counts only when it is this slot's own generated asset.
 */
function slotVisibleOnCut(
  payload: unknown,
  slot: {
    role: string;
    storySceneId: string | null;
    status: string;
    treatment: string;
    generatedAssetId: string | null;
    sourceMediaAssetId: string | null;
  },
): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const document = payload as {
    unmetMediaRoles?: Array<{ role?: unknown; storySceneId?: unknown }>;
    clips?: Array<{
      sourceKind?: unknown;
      generatedAssetId?: unknown;
      mediaRole?: unknown;
      storySceneId?: unknown;
      assetId?: unknown;
    }>;
  };
  const scene = sceneKey(slot.storySceneId);
  const unmet = (document.unmetMediaRoles ?? []).some(
    (item) => item.role === slot.role && sceneKey(item.storySceneId) === scene,
  );
  if (slot.status === "DEFERRED" || slot.status === "FAILED") {
    return unmet;
  }
  if (slot.status === "FALLBACK" && slot.treatment === "ORIGINAL") {
    if (unmet) {
      return true;
    }
    return (document.clips ?? []).some((clip) => {
      if (clip.sourceKind !== "MEDIA_ASSET" || clip.mediaRole !== slot.role || sceneKey(clip.storySceneId) !== scene) {
        return false;
      }
      if (slot.sourceMediaAssetId && clip.assetId !== slot.sourceMediaAssetId) {
        return false;
      }
      return true;
    });
  }
  if (unmet) {
    return true;
  }
  if (!slot.generatedAssetId) {
    return false;
  }
  return (document.clips ?? []).some(
    (clip) => clip.sourceKind === "GENERATED_ASSET" && clip.generatedAssetId === slot.generatedAssetId,
  );
}

function generatedAssetIdsInTimeline(payload: unknown): Set<string> {
  const ids = new Set<string>();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ids;
  }
  const clips = (payload as { clips?: unknown }).clips;
  if (!Array.isArray(clips)) {
    return ids;
  }
  for (const clip of clips) {
    if (!clip || typeof clip !== "object") {
      continue;
    }
    const row = clip as { sourceKind?: unknown; generatedAssetId?: unknown };
    if (row.sourceKind === "GENERATED_ASSET" && typeof row.generatedAssetId === "string" && row.generatedAssetId.length > 0) {
      ids.add(row.generatedAssetId);
    }
  }
  return ids;
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
