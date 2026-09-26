import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { HttpAssetGeneratorAdapter } from "@/server/adapters/assets/http-asset";
import { LocalDeterministicAssetGenerator } from "@/server/adapters/assets/local-deterministic";
import { LocalDeterministicTimelineComposer } from "@/server/adapters/timeline/local-deterministic";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { prisma } from "@/server/db";
import {
  GENERATED_ASSET_STATUSES,
  GeneratedAssetStatus,
  JobStatus,
  JobType,
  StoryStructureStatus,
  TimelineStatus,
} from "@/server/domain/status";
import type { AssetExecutionAttribution } from "@/server/adapters/assets/attribution";
import { AssetCapability, type AssetCapabilityValue } from "@/server/ports/capabilities";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import type { AssetGeneratorInput } from "@/server/assets/input";
import { GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION } from "@/server/assets/schema";
import type { GeneratedAssetDocument } from "@/server/assets/schema";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@/server/story/schema";
import {
  TIMELINE_DOCUMENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "@/server/timeline/schema";
import { PrismaAiVideoBudget, type AiVideoBudgetPort } from "@/server/sg/ai-video-budget";
import { resetLaneRegistryAlertDebounce } from "@/server/sg/lane-registry";
import { PrismaShotFulfillment } from "@/server/sg/shot-fulfillment";
import { AttributionService } from "@/server/services/attribution";
import { ConsentService } from "@/server/services/consent";
import { AnalysisService } from "@/server/services/analysis";
import { AssetContractService } from "@/server/services/asset-contract";
import { collectShotCueInput } from "@/server/sg/cue-context";
import { AssetService, type ShotCueCollector } from "@/server/services/asset";
import { AssetWorker } from "@/server/services/asset-worker";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { TimelineContractService } from "@/server/services/timeline-contract";
import { TimelineService } from "@/server/services/timeline";
import { TimelineWorker } from "@/server/services/timeline-worker";
import { TasteService } from "@/server/services/taste";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { emptyAssetAvailability, describeAssetAvailability } from "@/server/assets/provider-config";
import type { VideoBackend } from "@/server/gateways/yf-asset/backends/types";
import { parseYfAssetGatewayConfig } from "@/server/gateways/yf-asset/config";
import { YfAssetGenerateService } from "@/server/gateways/yf-asset/generate";
import { GatewayJobStore } from "@/server/gateways/yf-asset/jobs";
import { MemoryGatewayReservation } from "@/server/gateways/yf-asset/reservation";
import { SpendGuard } from "@/server/gateways/yf-asset/spend";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function sampleStory(): StoryDocument {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    title: "A quiet family afternoon",
    logline: "A family afternoon.",
    spine: {
      opening: "Arrive at home.",
      development: "The day unfolds.",
      resolution: "They sit together.",
    },
    acts: [
      {
        id: "act-opening",
        order: 0,
        purpose: "Establish place.",
        scenes: [
          {
            id: "scene-arrive",
            order: 0,
            purpose: "Introduce the people and place.",
            dramaticFunction: "exposition",
            mediaRoles: [
              { role: "establishing_visual", purpose: "Show the setting." },
              { role: "intimate_portrait", purpose: "Hold on a face." },
            ],
          },
        ],
      },
    ],
    source: { creativePlanId: "plan_seed", creativePlanVersion: 1 },
  };
}

function sampleTimeline(assetId: string, storyId: string): TimelineDocument {
  return {
    schemaVersion: TIMELINE_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor cut",
    totalDurationMs: 3000,
    tracks: [
      { trackKey: "video.primary", kind: "VIDEO" },
      { trackKey: "audio.voice", kind: "AUDIO" },
      { trackKey: "audio.music", kind: "AUDIO" },
      { trackKey: "caption.main", kind: "CAPTION" },
    ],
    clips: [
      {
        id: "clip-1",
        trackKey: "video.primary",
        order: 0,
        sourceKind: "MEDIA_ASSET",
        assetId,
        storySceneId: "scene-arrive",
        mediaRole: "establishing_visual",
        timelineStartMs: 0,
        timelineEndMs: 3000,
      },
    ],
    unmetMediaRoles: [
      {
        role: "intimate_portrait",
        storySceneId: "scene-arrive",
        reason: "No unused MediaAsset available for this story role.",
      },
    ],
    source: { storyStructureId: storyId, storyStructureVersion: 1 },
  };
}

function scriptedGenerator(
  generate: (input: AssetGeneratorInput) => Promise<GeneratedAssetDocument> | GeneratedAssetDocument,
): AssetGeneratorPort {
  return {
    async generate(input) {
      return generate(input);
    },
  };
}

const defaultAttribution = (
  overrides: Partial<AssetExecutionAttribution> = {},
): AssetExecutionAttribution => ({
  providerKey: "test.asset",
  capability: AssetCapability.IMAGE_GENERATION,
  modelId: "script-1",
  modelVersion: "1",
  ...overrides,
});

describe("AssetService M3", () => {
  const ownerId = `asset-owner-${Date.now()}`;
  const strangerId = `asset-stranger-${Date.now()}`;
  let projectId = "";
  let mediaAssetId = "";
  let dir = "";
  let storage: LocalStorageAdapter;
  let media: MediaService;
  let jobs: PostgresJobQueue;
  let contract: AssetContractService;
  let timelineContract: TimelineContractService;
  const projects = new ProjectService();
  const taste = new TasteService();
  const intent = new IntentService(projects, taste);
  const attribution = new AttributionService(projects);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-asset-"));
    storage = new LocalStorageAdapter(dir);
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: true },
        {
          id: strangerId,
          name: "Stranger",
          email: `${strangerId}@example.com`,
          emailVerified: false,
        },
      ],
    });
    const project = await projects.create(ownerId, {
      title: "Generated assets",
      logline: "M3.",
    });
    projectId = project.id;
    await new ConsentService().accept(ownerId);
    media = new MediaService(storage, projects);
    jobs = new PostgresJobQueue();
    const analysis = new AnalysisService(media, jobs, {
      async analyze() {
        throw new Error("analysis unused in M3 tests");
      },
    } as never);
    contract = new AssetContractService(projects, taste, intent);
    timelineContract = new TimelineContractService(projects, taste, intent, media, analysis);
    const ingested = await media.ingest(ownerId, projectId, {
      filename: "still.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    mediaAssetId = ingested.id;
    await intent.upsert(ownerId, projectId, {
      purpose: "A quiet family afternoon",
      mood: "warm",
      desiredDurationMs: 90_000,
    });
    const story = await seedReadyStory(sampleStory());
    await seedReadyTimeline(sampleTimeline(mediaAssetId, story.id), story);
  });

  afterAll(async () => {
    await prisma.timelineClip.deleteMany({ where: { timeline: { projectId } } });
    await prisma.generatedAsset.deleteMany({ where: { projectId } });
    await prisma.timeline.deleteMany({ where: { projectId } });
    await prisma.storyStructure.deleteMany({ where: { projectId } });
    await prisma.engineCostEvent.deleteMany({
      where: { usageEvent: { userId: { in: [ownerId, strangerId] } } },
    });
    await prisma.usageEvent.deleteMany({
      where: { userId: { in: [ownerId, strangerId] } },
    });
    await prisma.providerAttribution.deleteMany({ where: { projectId } });
    await prisma.job.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function harness(options: {
    adapter: AssetGeneratorPort | null;
    attribution?: AssetExecutionAttribution;
    productionAvailable?: boolean;
    localDevAvailable?: boolean;
    supportedCapabilities?: AssetCapabilityValue[];
    budgets?: AiVideoBudgetPort;
    fulfillments?: PrismaShotFulfillment;
    collectCues?: ShotCueCollector;
    resolveLanes?: () => import("@/server/assets/lane-resolver").AssetLaneResolver | null;
    probeHealth?: (baseUrl: string) => Promise<boolean>;
  }) {
    const productionAvailable = options.productionAvailable ?? Boolean(options.adapter);
    const localDevAvailable = options.localDevAvailable ?? false;
    const supported = options.supportedCapabilities ?? [
      AssetCapability.IMAGE_GENERATION,
      AssetCapability.VOICE_SYNTHESIS,
      AssetCapability.MUSIC_GENERATION,
      AssetCapability.SFX_GENERATION,
      AssetCapability.VIDEO_GENERATION,
      AssetCapability.MEDIA_ENHANCEMENT,
    ];
    const executionAttribution = options.attribution ?? defaultAttribution();
    const assets = new AssetService(
      jobs,
      storage,
      contract,
      projects,
      attribution,
      () =>
        options.adapter
          ? {
              adapter: options.adapter,
              attributionFor: () => executionAttribution,
              supportedCapabilities: supported,
            }
          : null,
      () => {
        if (!options.adapter) {
          return emptyAssetAvailability();
        }
        return describeAssetAvailability({
          adapter: options.adapter,
          attributionFor: () => executionAttribution,
          productionAvailable,
          localDevAvailable,
          supportedCapabilities: supported,
        });
      },
      undefined,
      undefined,
      options.budgets,
      options.fulfillments,
      options.collectCues,
      options.resolveLanes,
      options.probeHealth,
    );
    return { assets, worker: new AssetWorker(jobs, assets) };
  }

  function timelineHarness() {
    const local = new LocalDeterministicTimelineComposer();
    const timeline = new TimelineService(
      jobs,
      timelineContract,
      projects,
      attribution,
      () => ({ adapter: local, attribution: local.executionAttribution() }),
      () => ({
        productionAvailable: false,
        localDevAvailable: true,
        canCompose: true,
      }),
    );
    return { timeline, worker: new TimelineWorker(jobs, timeline) };
  }

  it("does not use job-type aliases and does not overload Director/Story/Timeline ports", () => {
    expect(JobType.AI_ASSET).toBe("AI_ASSET");
    expect("AI_GENERATE" in JobType).toBe(false);
    expect("ASSET_COMPOSE" in JobType).toBe(false);
    const director: AiDirectorPort = {
      composePlan: async () => ({ schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION }),
    };
    expect(director).not.toHaveProperty("generate");
    const story: StoryComposerPort = {
      composeStory: async () => sampleStory(),
    };
    expect(story).not.toHaveProperty("generate");
    const timeline: TimelineComposerPort = {
      composeTimeline: async () => sampleTimeline(mediaAssetId, "story"),
    };
    expect(timeline).not.toHaveProperty("generate");
  });

  it("records FAILED ASSET_CALL when generate throws", async () => {
    const { assets, worker } = harness({
      adapter: scriptedGenerator(() => {
        throw AppError.jobFailed("asset engine down");
      }),
      productionAvailable: true,
    });
    const queued = await assets.requestGenerate(ownerId, projectId);
    await worker.processNext();
    const usage = await prisma.usageEvent.findMany({
      where: { jobId: queued.jobId },
      include: { engineCosts: true },
    });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage[0]).toMatchObject({
      kind: "ASSET_CALL",
      outcome: "FAILED",
    });
    expect(usage[0]!.engineCosts[0]?.providerKey).toBe("test.asset");
  });

  it("HTTP request only enqueues AI_ASSET; worker persists READY GeneratedAsset", async () => {
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });

    const queued = await assets.requestGenerate(ownerId, projectId);
    expect(queued.status).toBe(JobStatus.PENDING);
    const job = await jobs.get(queued.jobId);
    expect(job?.type).toBe(JobType.AI_ASSET);
    expect(job?.status).toBe(JobStatus.PENDING);
    expect(await prisma.generatedAsset.count({ where: { projectId, status: GeneratedAssetStatus.READY } })).toBe(0);

    await worker.processNext();
    const ready = await assets.getLatestFulfillments(ownerId, projectId);
    expect(ready.length).toBeGreaterThan(0);
    expect(ready[0]?.status).toBe(GeneratedAssetStatus.READY);
    expect(ready[0]?.document.schemaVersion).toBe(GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION);
    expect(ready[0]?.document.storageKey).not.toMatch(/^https?:\/\//);
    expect(ready[0]?.kind).not.toBe("PHOTO");
    expect(ready[0]?.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(ready[0]?.timelineId).toBeTruthy();
    expect(await storage.exists(ready[0]!.document.storageKey)).toBe(true);

    const mediaCount = await prisma.mediaAsset.count({ where: { projectId } });
    expect(mediaCount).toBe(1);
    expect(ready[0]?.id).not.toBe(mediaAssetId);

    const jobAssets = await prisma.generatedAsset.findMany({
      where: { jobId: queued.jobId, status: GeneratedAssetStatus.READY },
    });
    const attempts = await prisma.shotFulfillmentAttempt.findMany({
      where: { jobId: queued.jobId },
      orderBy: { attemptNo: "asc" },
    });
    expect(attempts).toHaveLength(jobAssets.length);
    const slots = await prisma.shotFulfillment.findMany({
      where: { id: { in: attempts.map((row) => row.shotFulfillmentId) } },
    });
    expect(slots).toHaveLength(jobAssets.length);
    for (const slot of slots) {
      expect(slot.routingMode).toBe("LEGACY");
      expect(slot.shadowDecision).toMatchObject({
        treatment: "DEFER",
        laneId: null,
        messageKey: "SG_NO_QUALIFIED_LANE",
      });
      expect(slot.scope).toBe("IDENTITY");
      expect(slot.identityState).toBe("UNKNOWN");
      expect(slot.requiredScopes).toEqual(["IDENTITY"]);
      expect(slot.status).toBe("FULFILLED");
      expect(slot.generatedAssetId).toBeTruthy();
    }
    for (const attempt of attempts) {
      expect(attempt.outcome).toBe("SUCCEEDED");
      expect(attempt.attemptNo).toBeGreaterThanOrEqual(1);
      expect(attempt.classAttemptNo).toBeGreaterThanOrEqual(1);
      expect(attempt.laneClass).toBe("unclassified");
      expect(attempt.actualBilledSeconds).toBeNull();
      expect(attempt.gatewayReservationId).toBeNull();
      expect(attempt.budgetReservationId).toBeNull();
    }
    expect(new Set(slots.map((slot) => slot.slotKey)).size).toBe(slots.length);

    const status = await assets.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.SUCCEEDED);

    const usage = await prisma.usageEvent.findMany({
      where: { jobId: queued.jobId },
      include: { engineCosts: true },
    });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((event) => event.kind === "ASSET_CALL")).toBe(true);
    expect(usage.every((event) => event.outcome === "SUCCEEDED")).toBe(true);
    expect(usage[0]!.engineCosts[0]).toMatchObject({
      providerKey: "test.asset",
      capability: AssetCapability.IMAGE_GENERATION,
      costKind: "ESTIMATED",
    });
    expect(JSON.stringify(ready[0]!.document)).not.toMatch(/engineCost|costUnits|usageEvent/i);
  });

  it("requires a READY Timeline before enqueue", async () => {
    const isolated = await projects.create(ownerId, { title: "No cut yet" });
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(assets.requestGenerate(ownerId, isolated.id)).rejects.toMatchObject({
      code: "ASSET_TIMELINE_REQUIRED",
    });
    await prisma.project.delete({ where: { id: isolated.id } });
  });

  it("does not silently rewrite Timeline when generation succeeds", async () => {
    const before = await prisma.timeline.findFirst({
      where: { projectId, status: TimelineStatus.READY },
      orderBy: { version: "desc" },
    });
    const versionBefore = before!.version;
    const clipCountBefore = await prisma.timelineClip.count({
      where: { timelineId: before!.id },
    });
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await assets.requestGenerate(ownerId, projectId);
    await worker.processNext();
    const after = await prisma.timeline.findFirst({
      where: { projectId, status: TimelineStatus.READY },
      orderBy: { version: "desc" },
    });
    expect(after!.id).toBe(before!.id);
    expect(after!.version).toBe(versionBefore);
    expect(await prisma.timelineClip.count({ where: { timelineId: after!.id } })).toBe(
      clipCountBefore,
    );
  });

  it("explicit Rebuild cut may place READY GeneratedAssets and shrinks unmet roles", async () => {
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await assets.requestGenerate(ownerId, projectId);
    await worker.processNext();
    const generated = await assets.getLatestFulfillments(ownerId, projectId);
    expect(generated.length).toBeGreaterThan(0);

    const { timeline, worker: timelineWorker } = timelineHarness();
    const queued = await timeline.requestRebuild(ownerId, projectId);
    expect(queued.status).toBe(JobStatus.PENDING);
    await timelineWorker.processNext();
    const rebuilt = await timeline.getLatestReady(ownerId, projectId);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.document.clips.some((clip) => clip.sourceKind === "GENERATED_ASSET")).toBe(
      true,
    );
    expect(
      rebuilt!.document.unmetMediaRoles?.some((item) => item.role === "intimate_portrait"),
    ).not.toBe(true);
    const clips = await prisma.timelineClip.findMany({ where: { timelineId: rebuilt!.id } });
    expect(clips.some((clip) => clip.sourceKind === "GENERATED_ASSET" && clip.generatedAssetId)).toBe(
      true,
    );
    expect(clips.some((clip) => clip.sourceKind === "MEDIA_ASSET" && clip.assetId)).toBe(true);
  });

  it("local deterministic adapter does not advertise production availability", async () => {
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const avail = assets.getAvailability();
    expect(avail.productionAvailable).toBe(false);
    expect(avail.localDevAvailable).toBe(true);
    expect(avail.canGenerate).toBe(true);
    expect(avail.capabilities.IMAGE_GENERATION.productionAvailable).toBe(false);
    expect(avail.capabilities.VOICE_SYNTHESIS.localDevAvailable).toBe(true);
    expect(local.production).toBe(false);
  });

  it("missing capability is a typed error and does not mark READY", async () => {
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
      supportedCapabilities: [AssetCapability.VOICE_SYNTHESIS],
    });
    await expect(
      assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" }],
      }),
    ).rejects.toMatchObject({
      code: "ASSET_CAPABILITY_UNAVAILABLE",
    });
  });

  it("idempotent enqueue returns the open job for the same inputFingerprint", async () => {
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const request = {
      roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" as const }],
    };
    const first = await assets.requestGenerate(ownerId, projectId, request);
    const second = await assets.requestGenerate(ownerId, projectId, request);
    expect(second.jobId).toBe(first.jobId);
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
    const pending = await prisma.job.findMany({
      where: { projectId, type: JobType.AI_ASSET, status: JobStatus.PENDING },
    });
    expect(pending.filter((job) => job.id === first.jobId)).toHaveLength(1);
    await jobs.cancel(first.jobId);
  });

  it("cancel stops further work and keeps already-READY siblings", async () => {
    let calls = 0;
    const local = new LocalDeterministicAssetGenerator(storage);
    const adapter = scriptedGenerator(async (input) => {
      calls += 1;
      if (calls === 1) {
        return local.generate(input);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      return local.generate(input);
    });
    const { assets, worker } = harness({
      adapter,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await assets.requestGenerate(ownerId, projectId, {
      roles: [
        { role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" },
        { role: "voice_over", storySceneId: "scene-arrive", kind: "VOICE_OVER" },
      ],
    });
    const process = worker.processNext();
    await assets.cancelJob(ownerId, projectId, queued.jobId);
    await process;
    const status = await assets.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.CANCELLED);
    const rows = await prisma.generatedAsset.findMany({
      where: { projectId, jobId: queued.jobId },
    });
    expect(rows.every((row) => row.status !== GeneratedAssetStatus.READY || row.role)).toBe(true);
    const ready = rows.filter((row) => row.status === GeneratedAssetStatus.READY);
    expect(ready.length).toBeLessThanOrEqual(2);
  });

  it("failure does not rewrite READY siblings", async () => {
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await assets.requestGenerate(ownerId, projectId, {
      roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" }],
    });
    await worker.processNext();
    const readyBefore = await prisma.generatedAsset.findMany({
      where: { projectId, status: GeneratedAssetStatus.READY },
    });
    expect(readyBefore.length).toBeGreaterThan(0);

    const failing = scriptedGenerator(async () => {
      throw new Error("transient generator failure");
    });
    const { assets: failingAssets, worker: failingWorker } = harness({
      adapter: failing,
      productionAvailable: true,
    });
    const queued = await failingAssets.requestGenerate(ownerId, projectId, {
      roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" }],
    });
    await failingWorker.processNext();
    const status = await failingAssets.getJobStatus(ownerId, projectId, queued.jobId);
    expect(["FAILED", "PENDING"]).toContain(status.status);
    const stillReady = await prisma.generatedAsset.findMany({
      where: {
        id: { in: readyBefore.map((row) => row.id) },
      },
    });
    expect(stillReady.every((row) => row.status === GeneratedAssetStatus.READY)).toBe(true);
  });

  it("enforces ownership on generate, job status, and asset reads", async () => {
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const request = {
      roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" as const }],
    };
    await expect(assets.requestGenerate(strangerId, projectId, request)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const queued = await assets.requestGenerate(ownerId, projectId, request);
    await expect(assets.getJobStatus(strangerId, projectId, queued.jobId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(assets.listAssets(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await jobs.cancel(queued.jobId);
  });

  it("minimizes input privacy and does not persist raw input or vendor JSON on Story/Timeline", async () => {
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const timeline = await prisma.timeline.findFirst({
      where: { projectId, status: TimelineStatus.READY },
    });
    const story = await prisma.storyStructure.findFirst({
      where: { projectId, status: StoryStructureStatus.READY },
    });
    const input = await contract.assembleInput(
      ownerId,
      projectId,
      {
        id: timeline!.id,
        version: timeline!.version,
        document: timeline!.payload as TimelineDocument,
        storyStructureId: timeline!.storyStructureId,
        storyStructureVersion: timeline!.storyStructureVersion,
      },
      { role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" },
      story!.payload as StoryDocument,
    );
    const blob = JSON.stringify(input);
    expect(blob).not.toMatch(/apiKey|authorization|sponsor|email|storageKey/i);
    expect(input).not.toHaveProperty("userId");

    const queued = await assets.requestGenerate(ownerId, projectId, {
      roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" }],
    });
    await worker.processNext();
    const storedJob = await jobs.get(queued.jobId);
    expect(JSON.stringify(storedJob)).not.toContain('"creativeHints"');
    expect(JSON.stringify(timeline!.payload)).not.toMatch(/hostJson|providerPayload|cdnUrl/i);
    expect(JSON.stringify(story!.payload)).not.toMatch(/hostJson|providerPayload|cdnUrl/i);
  });

  it("writes no RenderJob, FinishedMovie, or Publication product paths", async () => {
    const rendersBefore = await prisma.renderJob.count({ where: { projectId } });
    const moviesBefore = await prisma.finishedMovie.count({ where: { projectId } });
    const publicationsBefore = await prisma.publication.count();
    const local = new LocalDeterministicAssetGenerator(storage);
    const { assets, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await assets.requestGenerate(ownerId, projectId, {
      roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" }],
    });
    await worker.processNext();
    expect(await prisma.renderJob.count({ where: { projectId } })).toBe(rendersBefore);
    expect(await prisma.finishedMovie.count({ where: { projectId } })).toBe(moviesBefore);
    expect(await prisma.publication.count()).toBe(publicationsBefore);
  });

  it("does not retry SPEND_CAP_REACHED and does not call another lane", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    const previousSeconds = process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    process.env.SG_BUDGET_PROJECT_MAX_SECONDS = "1";
    const calls: string[] = [];
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async () => {
          calls.push("generate");
          throw new Error("adapter should not run after a cap denial");
        }),
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" }],
      });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current?.status !== JobStatus.PENDING) break;
        const ran = await worker.processNext();
        if (!ran) break;
      }
      const job = await jobs.get(queued.jobId);
      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.attempts).toBe(1);
      expect(calls).toEqual([]);
      const reservation = await prisma.aiVideoBudgetReservation.findFirst({
        where: { projectId, idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
      });
      expect(reservation).toBeNull();
      const attempt = await prisma.shotFulfillmentAttempt.findFirst({
        where: { jobId: queued.jobId },
      });
      expect(attempt?.outcome).toBe("CAP_DENIED");
      expect(attempt?.failureCode).toBe("CAP_DENIED");
      expect(attempt?.budgetReservationId).toBeNull();
      expect(attempt?.gatewayReservationId).toBeNull();
      expect(attempt?.attemptNo).toBeGreaterThanOrEqual(1);
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      if (previousSeconds === undefined) delete process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
      else process.env.SG_BUDGET_PROJECT_MAX_SECONDS = previousSeconds;
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId: ownerId }] },
      });
    }
  });

  it("releases the app reservation with CAP_DENIED when the gateway returns 429", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    delete process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
    delete process.env.SG_BUDGET_PROJECT_MAX_USD;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_SECONDS;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_USD;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    const calls: string[] = [];
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async () => {
          calls.push("only-lane");
          throw AppError.spendCapReached();
        }),
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" }],
      });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current?.status !== JobStatus.PENDING) break;
        const ran = await worker.processNext();
        if (!ran) break;
      }
      expect(calls).toEqual(["only-lane"]);
      const job = await jobs.get(queued.jobId);
      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.attempts).toBe(1);
      const reservation = await prisma.aiVideoBudgetReservation.findFirst({
        where: { projectId, settleReason: "CAP_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(reservation?.status).toBe("RELEASED");
      expect(reservation?.settleReason).toBe("CAP_DENIED");
      expect(reservation?.laneId).toBe("r1-wan27-replicate");
      expect(reservation?.providerKey).toBe("replicate:wan-video/wan-2.7-i2v");
      const attempt = await prisma.shotFulfillmentAttempt.findFirst({
        where: { jobId: queued.jobId },
      });
      expect(attempt?.outcome).toBe("CAP_DENIED");
      expect(attempt?.budgetReservationId).toBe(reservation?.id);
      expect(attempt?.gatewayReservationId).toBeNull();
      expect(attempt?.laneId).toBe("r1-wan27-replicate");
      expect(attempt?.laneClass).toBe("standard");
      expect(attempt?.providerKey).toBe("replicate:wan-video/wan-2.7-i2v");
      expect(attempt?.classAttemptNo).toBeGreaterThanOrEqual(1);
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId: ownerId }] },
      });
    }
  });

  it("records the registry laneClass, version, and sha on a priced attempt", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    const previousRegistry = process.env.SG_LANE_REGISTRY_PATH;
    delete process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
    delete process.env.SG_BUDGET_PROJECT_MAX_USD;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_SECONDS;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_USD;
    const dir = await mkdtemp(path.join(tmpdir(), "youflicks-asset-lane-class-"));
    const sourcePath = path.join(process.cwd(), "config/sg-lane-registry.json");
    const doc = JSON.parse(readFileSync(sourcePath, "utf8")) as {
      registryVersion: string;
      lanes: Array<{ laneId: string; laneClass: string }>;
    };
    const row = doc.lanes.find((item) => item.laneId === "r1-wan27-replicate");
    expect(row).toBeTruthy();
    row!.laneClass = "premium";
    const file = path.join(dir, "registry.json");
    await writeFile(file, JSON.stringify(doc), "utf8");
    process.env.SG_LANE_REGISTRY_PATH = file;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async () => {
          throw AppError.spendCapReached();
        }),
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-registry-class", kind: "IMAGE" }],
      });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current?.status !== JobStatus.PENDING) break;
        const ran = await worker.processNext();
        if (!ran) break;
      }
      const attempt = await prisma.shotFulfillmentAttempt.findFirst({
        where: { jobId: queued.jobId },
      });
      expect(attempt?.laneClass).toBe("premium");
      expect(attempt?.laneId).toBe("r1-wan27-replicate");
      const slot = await prisma.shotFulfillment.findFirst({
        where: { id: attempt?.shotFulfillmentId },
      });
      const bytes = readFileSync(file);
      expect(slot?.registryVersion).toBe(doc.registryVersion);
      expect(slot?.registryVersion).not.toBe("v0");
      expect(slot?.registrySha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(slot?.registrySha256).not.toBe("unavailable");
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      if (previousRegistry === undefined) delete process.env.SG_LANE_REGISTRY_PATH;
      else process.env.SG_LANE_REGISTRY_PATH = previousRegistry;
      await rm(dir, { recursive: true, force: true });
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId: ownerId }] },
      });
    }
  });

  async function runPricedJob(sceneId: string, adapter: AssetGeneratorPort) {
    const { assets, worker } = harness({
      adapter,
      productionAvailable: true,
      supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
    });
    const queued = await assets.requestGenerate(ownerId, projectId, {
      roles: [{ role: "intimate_portrait", storySceneId: sceneId, kind: "IMAGE" }],
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await jobs.get(queued.jobId);
      if (current?.status !== JobStatus.PENDING) break;
      const ran = await worker.processNext();
      if (!ran) break;
    }
    return queued.jobId;
  }

  function clearBudgetCaps() {
    delete process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
    delete process.env.SG_BUDGET_PROJECT_MAX_USD;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_SECONDS;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_USD;
  }

  it("refuses a disabled lane before any provider call, hold, or attempt", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    const previousRegistry = process.env.SG_LANE_REGISTRY_PATH;
    clearBudgetCaps();
    const scratch = await mkdtemp(path.join(tmpdir(), "youflicks-asset-disabled-lane-"));
    const file = path.join(scratch, "registry.json");
    const doc = JSON.parse(
      readFileSync(path.join(process.cwd(), "config/sg-lane-registry.json"), "utf8"),
    ) as { lanes: Array<{ laneId: string; enabled: boolean }> };
    const row = doc.lanes.find((item) => item.laneId === "r1-wan27-replicate");
    expect(row).toBeTruthy();
    row!.enabled = false;
    await writeFile(file, JSON.stringify(doc), "utf8");
    process.env.SG_LANE_REGISTRY_PATH = file;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    const calls: string[] = [];
    try {
      const jobId = await runPricedJob(
        "scene-disabled-lane",
        scriptedGenerator(async () => {
          calls.push("generate");
          throw new Error("adapter should not run");
        }),
      );
      const job = await jobs.get(jobId);
      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.attempts).toBe(1);
      expect(calls).toEqual([]);
      const reservation = await prisma.aiVideoBudgetReservation.findFirst({
        where: { idempotencyKey: { startsWith: `asset:${jobId}:` } },
      });
      expect(reservation).toBeNull();
      const attempt = await prisma.shotFulfillmentAttempt.findFirst({ where: { jobId } });
      expect(attempt).toBeNull();
      const slot = await prisma.shotFulfillment.findFirst({
        where: { projectId, slotKey: { contains: "scene-disabled-lane" } },
      });
      expect(slot?.status).toBe("FAILED");
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      if (previousRegistry === undefined) delete process.env.SG_LANE_REGISTRY_PATH;
      else process.env.SG_LANE_REGISTRY_PATH = previousRegistry;
      await rm(scratch, { recursive: true, force: true });
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId: ownerId }] },
      });
    }
  });

  it("refuses a TBD lane on the app path before any provider call, hold, or attempt", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    const previousRegistry = process.env.SG_LANE_REGISTRY_PATH;
    clearBudgetCaps();
    delete process.env.SG_LANE_REGISTRY_PATH;
    process.env.YF_GATEWAY_LANE_ID = "boreal-720";
    const calls: string[] = [];
    try {
      const jobId = await runPricedJob(
        "scene-tbd-lane",
        scriptedGenerator(async () => {
          calls.push("generate");
          throw new Error("adapter should not run");
        }),
      );
      const job = await jobs.get(jobId);
      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.attempts).toBe(1);
      expect(calls).toEqual([]);
      const reservation = await prisma.aiVideoBudgetReservation.findFirst({
        where: { idempotencyKey: { startsWith: `asset:${jobId}:` } },
      });
      expect(reservation).toBeNull();
      const attempt = await prisma.shotFulfillmentAttempt.findFirst({ where: { jobId } });
      expect(attempt).toBeNull();
      const slot = await prisma.shotFulfillment.findFirst({
        where: { projectId, slotKey: { contains: "scene-tbd-lane" } },
      });
      expect(slot?.status).toBe("FAILED");
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      if (previousRegistry === undefined) delete process.env.SG_LANE_REGISTRY_PATH;
      else process.env.SG_LANE_REGISTRY_PATH = previousRegistry;
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId: ownerId }] },
      });
    }
  });

  it("settles an existing hold after the lane is disabled", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    const previousRegistry = process.env.SG_LANE_REGISTRY_PATH;
    clearBudgetCaps();
    const scratch = await mkdtemp(path.join(tmpdir(), "youflicks-asset-settle-disabled-"));
    const file = path.join(scratch, "registry.json");
    const doc = JSON.parse(
      readFileSync(path.join(process.cwd(), "config/sg-lane-registry.json"), "utf8"),
    ) as { lanes: Array<{ laneId: string; enabled: boolean; designation: string }> };
    const live = doc.lanes.find((item) => item.laneId === "r1-wan27-replicate");
    expect(live).toBeTruthy();
    live!.designation = "NONE";
    await writeFile(file, JSON.stringify(doc), "utf8");
    process.env.SG_LANE_REGISTRY_PATH = file;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    const local = new LocalDeterministicAssetGenerator(storage);
    const calls: string[] = [];
    try {
      const jobId = await runPricedJob(
        "scene-settle-disabled",
        scriptedGenerator(async (input) => {
          calls.push("generate");
          const doc = JSON.parse(readFileSync(file, "utf8")) as {
            lanes: Array<{ laneId: string; enabled: boolean }>;
          };
          const row = doc.lanes.find((item) => item.laneId === "r1-wan27-replicate");
          expect(row?.enabled).toBe(true);
          row!.enabled = false;
          await writeFile(file, JSON.stringify(doc), "utf8");
          return local.generate(input);
        }),
      );
      expect(calls).toEqual(["generate"]);
      const job = await jobs.get(jobId);
      expect(job?.status).toBe(JobStatus.SUCCEEDED);
      const reservation = await prisma.aiVideoBudgetReservation.findFirst({
        where: { idempotencyKey: { startsWith: `asset:${jobId}:` } },
      });
      expect(reservation?.status).toBe("RECONCILED");
      expect(reservation?.laneId).toBe("r1-wan27-replicate");
      const attempt = await prisma.shotFulfillmentAttempt.findFirst({ where: { jobId } });
      expect(attempt?.outcome).toBe("SUCCEEDED");
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      if (previousRegistry === undefined) delete process.env.SG_LANE_REGISTRY_PATH;
      else process.env.SG_LANE_REGISTRY_PATH = previousRegistry;
      await rm(scratch, { recursive: true, force: true });
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId: ownerId }] },
      });
    }
  });

  async function settleThroughGateway(
    backend: VideoBackend,
    download: typeof fetch = async () => new Response("clip"),
    configOverrides: Record<string, string> = {},
  ) {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    delete process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
    delete process.env.SG_BUDGET_PROJECT_MAX_USD;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_SECONDS;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_USD;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    const store = new MemoryGatewayReservation();
    const ledgerId = `app-settle-${Math.random().toString(16).slice(2)}`;
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_MODEL: "wan-video/wan-2.7-i2v",
      YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
      YF_GATEWAY_CAPABILITIES: "IMAGE_GENERATION",
      YF_GATEWAY_MAX_JOBS: "10",
      YF_GATEWAY_MAX_SPEND_USD: "100",
      YF_GATEWAY_POLL_MS: "1",
      YF_GATEWAY_TIMEOUT_MS: "40",
      YF_GATEWAY_LEDGER_ID: ledgerId,
      ...configOverrides,
    });
    const gateway = new YfAssetGenerateService(
      config,
      backend,
      new GatewayJobStore(),
      new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob),
      download,
      async () => {},
      store,
    );
    const adapter = new HttpAssetGeneratorAdapter(
      storage,
      {
        providerKey: "http.asset",
        baseUrl: "http://gateway.test",
        apiKey: "gw-key",
        model: "wan-video/wan-2.7-i2v",
        capabilities: [AssetCapability.IMAGE_GENERATION],
        timeoutMs: 5_000,
      },
      async (_url, init) => {
        const raw = JSON.parse(String(init?.body ?? "{}")) as unknown;
        const result = await gateway.generate(raw);
        return new Response(JSON.stringify(result.body), { status: result.status });
      },
    );
    try {
      const { assets, worker } = harness({
        adapter,
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" }],
      });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current?.status !== JobStatus.PENDING) break;
        const ran = await worker.processNext();
        if (!ran) break;
      }
      const reservation = await prisma.aiVideoBudgetReservation.findFirst({
        where: { idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
      });
      const gatewayRow = store.list().find((item) => item.ledgerIds.includes(ledgerId));
      return { reservation, gatewayRow };
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId: ownerId }] },
      });
    }
  }

  it("records CAP_DENIED when the gateway returns 429 and creates no gateway reservation", async () => {
    let submits = 0;
    const blocked: VideoBackend = {
      kind: "http",
      async submit() {
        submits += 1;
        return { backendRequestId: "should-not-submit" };
      },
      async status() {
        return { status: "queued" };
      },
      async result() {
        throw new Error("no result");
      },
    };
    const { reservation, gatewayRow } = await settleThroughGateway(
      blocked,
      async () => new Response("no"),
      { YF_GATEWAY_MAX_SPEND_USD: "0.01" },
    );
    expect(submits).toBe(0);
    expect(gatewayRow).toBeUndefined();
    expect(reservation?.status).toBe("RELEASED");
    expect(reservation?.settleReason).toBe("CAP_DENIED");
    const attempt = await prisma.shotFulfillmentAttempt.findFirst({
      where: { budgetReservationId: reservation?.id },
    });
    expect(attempt?.outcome).toBe("CAP_DENIED");
    expect(attempt?.failureCode).toBe("CAP_DENIED");
    expect(attempt?.budgetReservationId).toBe(reservation?.id);
    expect(attempt?.gatewayReservationId).toBeNull();
  });

  it("records SUCCEEDED with reconciled seconds and the gateway reservation id", async () => {
    const ready: VideoBackend = {
      kind: "http",
      async submit() {
        return { backendRequestId: "ok_success" };
      },
      async status() {
        return { status: "succeeded" };
      },
      async result() {
        return {
          url: "https://example.test/clip.png",
          mimeType: "image/png",
          durationMs: 5000,
          width: 2,
          height: 2,
        };
      },
    };
    const { reservation, gatewayRow } = await settleThroughGateway(ready, async () => {
      return new Response(PNG_1X1);
    });
    expect(reservation?.status).toBe("RECONCILED");
    expect(gatewayRow?.status).toBe("RECONCILED");
    const attempt = await prisma.shotFulfillmentAttempt.findFirst({
      where: { budgetReservationId: reservation?.id },
    });
    expect(reservation?.gatewayReservationId).toBe(gatewayRow?.id);
    expect(attempt?.outcome).toBe("SUCCEEDED");
    expect(attempt?.actualBilledSeconds).toBe(5);
    expect(attempt?.actualUsd).toBeCloseTo(0.5, 5);
    expect(attempt?.gatewayReservationId).toBe(gatewayRow?.id);
    expect(attempt?.gatewayJobId).toBeTruthy();
    expect(attempt?.generatedAssetId).toBeTruthy();
    const slot = await prisma.shotFulfillment.findUniqueOrThrow({
      where: { id: attempt?.shotFulfillmentId },
    });
    expect(slot.routingMode).toBe("LEGACY");
    expect(slot.shadowDecision).toMatchObject({
      treatment: "DEFER",
      laneId: null,
      providerKey: null,
    });
    expect(slot.generatedAssetId).toBe(attempt?.generatedAssetId);
  });

  it("keeps the app budget UNRECONCILED when the gateway times out", async () => {
    const hung: VideoBackend = {
      kind: "http",
      async submit() {
        return { backendRequestId: "hung_1" };
      },
      async status() {
        return { status: "running" };
      },
      async result() {
        throw new Error("no result");
      },
    };
    const { reservation, gatewayRow } = await settleThroughGateway(hung);
    expect(gatewayRow?.status).toBe("UNRECONCILED");
    expect(gatewayRow?.settleReason).toBe("TIMEOUT");
    expect(reservation?.status).toBe("UNRECONCILED");
    expect(reservation?.settleReason).toBe("GATEWAY_UNRECONCILED");
    expect(reservation?.gatewayReservationId).toBe(gatewayRow?.id);
    const attempt = await prisma.shotFulfillmentAttempt.findFirst({
      where: { budgetReservationId: reservation?.id },
    });
    expect(attempt?.outcome).toBe("TIMEOUT_UNRECONCILED");
    expect(attempt?.failureCode).toBe("TIMEOUT");
    expect(attempt?.gatewayReservationId).toBe(gatewayRow?.id);
    expect(attempt?.actualBilledSeconds).toBeNull();
  });

  it("reconciles the app budget when download fails after a billed success", async () => {
    const ready: VideoBackend = {
      kind: "http",
      async submit() {
        return { backendRequestId: "ok_1" };
      },
      async status() {
        return { status: "succeeded" };
      },
      async result() {
        return {
          url: "https://example.test/clip.mp4",
          mimeType: "image/png",
          durationMs: 5000,
        };
      },
    };
    const { reservation, gatewayRow } = await settleThroughGateway(
      ready,
      async () => new Response("nope", { status: 500 }),
    );
    expect(gatewayRow?.status).toBe("RECONCILED");
    expect(reservation?.status).toBe("RECONCILED");
    expect(reservation?.settleReason).toBe("GATEWAY_RECONCILED");
    expect(reservation?.actualBilledSeconds).toBe(5);
    const attempt = await prisma.shotFulfillmentAttempt.findFirst({
      where: { budgetReservationId: reservation?.id },
    });
    expect(attempt?.outcome).toBe("FAILED");
    expect(attempt?.failureCode).toBe("DOWNLOAD_FAILURE_BILLED");
    expect(attempt?.actualBilledSeconds).toBe(5);
    expect(attempt?.actualUsd).toBeCloseTo(0.5, 5);
    expect(attempt?.gatewayReservationId).toBe(gatewayRow?.id);
  });

  it("releases the app budget when submit returns 422", async () => {
    const rejected: VideoBackend = {
      kind: "http",
      async submit() {
        throw new Error("Backend submit failed (422): invalid input");
      },
      async status() {
        return { status: "queued" };
      },
      async result() {
        throw new Error("no result");
      },
    };
    const { reservation, gatewayRow } = await settleThroughGateway(rejected);
    expect(gatewayRow?.status).toBe("RELEASED");
    expect(reservation?.status).toBe("RELEASED");
    expect(reservation?.settleReason).toBe("GATEWAY_RELEASED");
    const attempt = await prisma.shotFulfillmentAttempt.findFirst({
      where: { budgetReservationId: reservation?.id },
    });
    expect(attempt?.outcome).toBe("FAILED");
    expect(attempt?.failureCode).toBe("SUBMIT_REJECTED");
    expect(reservation?.gatewayReservationId).toBe(gatewayRow?.id);
    expect(attempt?.gatewayReservationId).toBe(gatewayRow?.id);
    expect(attempt?.actualBilledSeconds).toBeNull();
  });

  it("releases the app budget when the gateway errors before reserving", async () => {
    const neverCalled: VideoBackend = {
      kind: "http",
      async submit() {
        throw new Error("backend must not be called before a reservation exists");
      },
      async status() {
        return { status: "queued" };
      },
      async result() {
        throw new Error("no result");
      },
    };
    const { reservation, gatewayRow } = await settleThroughGateway(neverCalled, async () => new Response("no"), {
      YF_GATEWAY_BACKEND_INPUT_JSON: JSON.stringify({ duration: 9 }),
    });
    expect(gatewayRow).toBeUndefined();
    expect(reservation?.status).toBe("RELEASED");
    expect(reservation?.settleReason).toBe("GATEWAY_NONE");
  });

  it("marks the app budget UNRECONCILED when the gateway settlement is missing", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    delete process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
    delete process.env.SG_BUDGET_PROJECT_MAX_USD;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_SECONDS;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_USD;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async () => {
          throw AppError.assetProviderUnavailable("The asset generator adapter failed.");
        }),
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-arrive", kind: "IMAGE" }],
      });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current?.status !== JobStatus.PENDING) break;
        const ran = await worker.processNext();
        if (!ran) break;
      }
      const reservation = await prisma.aiVideoBudgetReservation.findFirst({
        where: { idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
      });
      expect(reservation?.status).toBe("UNRECONCILED");
      expect(reservation?.settleReason).toBe("SETTLEMENT_MISSING");
      const attempt = await prisma.shotFulfillmentAttempt.findFirst({
        where: { jobId: queued.jobId },
      });
      expect(attempt?.outcome).toBe("TIMEOUT_UNRECONCILED");
      expect(attempt?.failureCode).toBe("SETTLEMENT_MISSING");
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId: ownerId }] },
      });
    }
  });

  async function runProxiedGatewayFailure(response: Response, storySceneId: string) {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    delete process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
    delete process.env.SG_BUDGET_PROJECT_MAX_USD;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_SECONDS;
    delete process.env.SG_BUDGET_USER_WINDOW_MAX_USD;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
      originalLog.apply(console, args);
    };
    try {
      const adapter = new HttpAssetGeneratorAdapter(
        storage,
        {
          providerKey: "http.asset",
          baseUrl: "http://gateway.test",
          apiKey: "gw-key",
          model: "open.model",
          capabilities: [AssetCapability.IMAGE_GENERATION],
          timeoutMs: 5_000,
        },
        async () => response,
      );
      const { assets, worker } = harness({
        adapter,
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId, kind: "IMAGE" }],
      });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current && current.status !== JobStatus.PENDING && current.status !== JobStatus.RUNNING) {
          break;
        }
        const ran = await worker.processNext();
        if (!ran) break;
      }
      const reservation = await prisma.aiVideoBudgetReservation.findFirst({
        where: { idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
      });
      const attempt = await prisma.shotFulfillmentAttempt.findFirst({
        where: { jobId: queued.jobId },
      });
      const logged = lines
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is Record<string, unknown> => entry?.message === "asset.fulfillment_attempt");
      return { reservation, attempt, logged, jobId: queued.jobId };
    } finally {
      console.log = originalLog;
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      await prisma.aiVideoBudgetLedger.deleteMany({
        where: { OR: [{ projectId }, { userId: ownerId }] },
      });
    }
  }

  it("records TIMEOUT_UNRECONCILED when a proxy 404 has no settlement", async () => {
    const { reservation, attempt, logged } = await runProxiedGatewayFailure(
      new Response("not found", { status: 404 }),
      "scene-proxy-404",
    );
    expect(reservation?.status).toBe("UNRECONCILED");
    expect(reservation?.settleReason).toBe("SETTLEMENT_MISSING");
    expect(attempt?.outcome).toBe("TIMEOUT_UNRECONCILED");
    expect(attempt?.failureCode).toBe("SETTLEMENT_MISSING");
    expect(logged.some((entry) => entry.outcome === "TIMEOUT_UNRECONCILED")).toBe(true);
    for (const entry of logged) {
      expect(Object.keys(entry).sort()).toEqual([
        "attemptNo",
        "budgetReservationId",
        "classAttemptNo",
        "gatewayReservationId",
        "jobId",
        "laneId",
        "level",
        "message",
        "outcome",
        "projectId",
        "providerKey",
        "service",
        "slotKey",
        "time",
      ]);
    }
  });

  it("records TIMEOUT_UNRECONCILED when a proxy 413 has no settlement", async () => {
    const { reservation, attempt } = await runProxiedGatewayFailure(
      new Response(JSON.stringify({ code: "PAYLOAD_TOO_LARGE" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      }),
      "scene-proxy-413",
    );
    expect(reservation?.status).toBe("UNRECONCILED");
    expect(reservation?.settleReason).toBe("SETTLEMENT_MISSING");
    expect(attempt?.outcome).toBe("TIMEOUT_UNRECONCILED");
    expect(attempt?.failureCode).toBe("PAYLOAD_TOO_LARGE");
  });

  it("records TIMEOUT_UNRECONCILED when a 400 carries settlement UNRECONCILED", async () => {
    const { reservation, attempt } = await runProxiedGatewayFailure(
      new Response(JSON.stringify({ settlement: "UNRECONCILED", settleReason: "UNKNOWN" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
      "scene-proxy-400",
    );
    expect(reservation?.status).toBe("UNRECONCILED");
    expect(reservation?.settleReason).toBe("GATEWAY_UNRECONCILED");
    expect(attempt?.outcome).toBe("TIMEOUT_UNRECONCILED");
    expect(attempt?.failureCode).toBe("UNKNOWN");
  });

  function budgetThatThrows(error: unknown): AiVideoBudgetPort {
    return {
      async reserve() {
        throw error;
      },
      async release(id) {
        throw new Error(`unused release ${id}`);
      },
      async reconcile(id) {
        throw new Error(`unused reconcile ${id}`);
      },
      async markUnreconciled(id) {
        throw new Error(`unused unreconcile ${id}`);
      },
      async rememberGatewayReservationId(id) {
        throw new Error(`unused gateway id ${id}`);
      },
      async snapshot() {
        return null;
      },
    };
  }

  it("writes no attempt when reserve fails with an AppError other than SPEND_CAP_REACHED", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    const calls: string[] = [];
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async () => {
          calls.push("generate");
          throw new Error("provider must not be called");
        }),
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
        budgets: budgetThatThrows(
          AppError.assetProviderUnavailable(
            "Lane r1-wan27-replicate is not in the registry. The gateway fails closed.",
          ),
        ),
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-reserve-app-error", kind: "IMAGE" }],
      });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current && current.status !== JobStatus.PENDING && current.status !== JobStatus.RUNNING) {
          break;
        }
        const ran = await worker.processNext();
        if (!ran) break;
      }
      const job = await jobs.get(queued.jobId);
      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.attempts).toBe(1);
      expect(calls).toEqual([]);
      expect(await prisma.shotFulfillmentAttempt.count({ where: { jobId: queued.jobId } })).toBe(0);
      const slot = await prisma.shotFulfillment.findFirst({
        where: { projectId, storySceneId: "scene-reserve-app-error" },
      });
      expect(slot?.status).toBe("FAILED");
      expect(
        await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot?.id } }),
      ).toBe(0);
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
    }
  });

  it("keeps the original AppError when markUnattemptedFailure throws", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    const fulfillments = new PrismaShotFulfillment(prisma);
    fulfillments.markUnattemptedFailure = async () => {
      throw new Error("marker write failed");
    };
    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((arg) => String(arg)).join(" "));
      originalWarn.apply(console, args);
    };
    const calls: string[] = [];
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async () => {
          calls.push("generate");
          throw new Error("provider must not be called");
        }),
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
        budgets: budgetThatThrows(AppError.assetProviderUnavailable("registry vanished after quote")),
        fulfillments,
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-marker-mask", kind: "IMAGE" }],
      });
      await worker.processNext();
      const job = await jobs.get(queued.jobId);
      expect(calls).toEqual([]);
      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.attempts).toBe(1);
      expect(job?.error).toBe("registry vanished after quote");
      expect(job?.error).not.toContain("marker write failed");
      expect(await prisma.shotFulfillmentAttempt.count({ where: { jobId: queued.jobId } })).toBe(0);
      const logged = warns
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is Record<string, unknown> => entry?.message === "asset.slot_mark_failed");
      expect(logged.some((entry) => entry.error === "marker write failed" && entry.jobId === queued.jobId)).toBe(
        true,
      );
    } finally {
      console.warn = originalWarn;
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
    }
  });

  it("writes no attempt when reserve throws a non-AppError, including on retry", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    const calls: string[] = [];
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async () => {
          calls.push("generate");
          throw new Error("provider must not be called");
        }),
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
        budgets: budgetThatThrows(new Error("db connection reset")),
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-reserve-db-error", kind: "IMAGE" }],
      });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current && current.attempts >= 1 && current.status !== JobStatus.RUNNING) break;
        const ran = await worker.processNext();
        if (!ran) break;
      }
      expect((await jobs.get(queued.jobId))?.attempts).toBe(1);
      expect(calls).toEqual([]);
      expect(await prisma.shotFulfillmentAttempt.count({ where: { jobId: queued.jobId } })).toBe(0);

      await prisma.job.update({
        where: { id: queued.jobId },
        data: { runAfter: new Date(0) },
      });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current && current.attempts >= 2) break;
        await prisma.job.update({
          where: { id: queued.jobId },
          data: { runAfter: new Date(0) },
        });
        const ran = await worker.processNext();
        if (!ran) break;
      }
      const job = await jobs.get(queued.jobId);
      expect(job?.attempts).toBe(2);
      expect(calls).toEqual([]);
      expect(await prisma.shotFulfillmentAttempt.count({ where: { jobId: queued.jobId } })).toBe(0);
      const slot = await prisma.shotFulfillment.findFirst({
        where: { projectId, storySceneId: "scene-reserve-db-error" },
      });
      expect(slot?.status).toBe("FAILED");
      expect(
        await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot?.id } }),
      ).toBe(0);
    } finally {
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
    }
  });

  it("writes no attempt when the lane registry cannot be read", async () => {
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    const previousRegistry = process.env.SG_LANE_REGISTRY_PATH;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    process.env.SG_LANE_REGISTRY_PATH = "/tmp/youflicks-missing-lane-registry.json";
    resetLaneRegistryAlertDebounce();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    let calls = 0;
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async () => {
          calls += 1;
          throw new Error("provider must not be called");
        }),
        productionAvailable: true,
        supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-registry-miss", kind: "IMAGE" }],
      });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await jobs.get(queued.jobId);
        if (current && current.status !== JobStatus.PENDING && current.status !== JobStatus.RUNNING) {
          break;
        }
        const ran = await worker.processNext();
        if (!ran) break;
      }
      expect(calls).toBe(0);
      const attempts = await prisma.shotFulfillmentAttempt.findMany({
        where: { jobId: queued.jobId },
      });
      expect(attempts).toHaveLength(0);
      const slot = await prisma.shotFulfillment.findFirst({
        where: { projectId, storySceneId: "scene-registry-miss" },
      });
      expect(slot?.status).toBe("FAILED");
      const reservation = await prisma.aiVideoBudgetReservation.findFirst({
        where: { idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
      });
      expect(reservation).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        "ops.alert",
        expect.objectContaining({ alertKind: "LANE_REGISTRY_INVALID" }),
      );
    } finally {
      errorSpy.mockRestore();
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
      if (previousRegistry === undefined) delete process.env.SG_LANE_REGISTRY_PATH;
      else process.env.SG_LANE_REGISTRY_PATH = previousRegistry;
    }
  });

  it("records REJECTED_TECHNICAL when the returned document fails the output contract", async () => {
    const local = new LocalDeterministicAssetGenerator(storage);
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
      originalLog.apply(console, args);
    };
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async (input) => {
          const document = await local.generate(input);
          return { ...document, role: "not-the-requested-role" };
        }),
        productionAvailable: false,
        localDevAvailable: true,
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "intimate_portrait", storySceneId: "scene-output-reject", kind: "IMAGE" }],
      });
      await worker.processNext();
      const attempt = await prisma.shotFulfillmentAttempt.findFirst({
        where: { jobId: queued.jobId },
      });
      expect(attempt?.outcome).toBe("REJECTED_TECHNICAL");
      expect(attempt?.failureCode).toBe("ASSET_DOCUMENT_INVALID");
      const logged = lines
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is Record<string, unknown> => entry?.message === "asset.fulfillment_attempt");
      expect(logged.some((entry) => entry.outcome === "REJECTED_TECHNICAL" && entry.jobId === queued.jobId)).toBe(
        true,
      );
    } finally {
      console.log = originalLog;
    }
  });

  it("keeps GeneratedAsset status on the locked enum; in-progress lives on Job only", async () => {
    const rows = await prisma.generatedAsset.findMany({ where: { projectId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(GENERATED_ASSET_STATUSES).toContain(row.status);
      expect(["PENDING", "RUNNING", "QUEUED", "PROCESSING"]).not.toContain(row.status);
    }
    const assetJobs = await prisma.job.findMany({
      where: { projectId, type: JobType.AI_ASSET },
    });
    expect(assetJobs.some((job) => job.status === JobStatus.SUCCEEDED)).toBe(true);
  });

  it("writes extracted cues onto the slot for a non-enhancement job that names a source", async () => {
    const photo = await prisma.mediaAsset.create({
      data: {
        projectId,
        kind: "PHOTO",
        filename: "empty-room.png",
        mimeType: "image/png",
        byteSize: 8,
        storageKey: `pr6-mf2/${projectId}/empty-room`,
        status: "READY",
        analysisStatus: "COMPLETED",
      },
    });
    await prisma.mediaAnalysis.create({
      data: {
        assetId: photo.id,
        providerKey: "test.analysis",
        schemaVersion: "1.0",
        status: "COMPLETED",
        payload: {
          analysisSchemaVersion: "1.0",
          people: { count: 0, people: [], recurringPersonIds: [] },
        } as Prisma.InputJsonValue,
      },
    });
    const { assets } = harness({
      adapter: scriptedGenerator(async () => {
        throw new Error("stop after cues");
      }),
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await assets.requestGenerate(ownerId, projectId, {
      roles: [
        {
          role: "empty_room_clip",
          storySceneId: "scene-arrive",
          kind: "VIDEO_CLIP",
          sourceMediaAssetId: photo.id,
        },
      ],
    });
    try {
      const job = await jobs.get(queued.jobId);
      await expect(assets.processJob(job!)).rejects.toThrow("stop after cues");
      const slot = await prisma.shotFulfillment.findFirst({
        where: { projectId, role: "empty_room_clip", storySceneId: "scene-arrive" },
      });
      expect(slot?.identityState).toBe("UNKNOWN");
      expect(slot?.scope).toBe("IDENTITY");
      expect(slot?.requiredScopes).toEqual(["IDENTITY"]);
      expect(slot?.shotRole).toBe("other");
      expect(slot?.identityEvidence).toEqual({
        faceCount: 0,
        faceDetected: false,
        recurringPersonCount: 0,
        analysisCompleted: false,
      });
      expect(slot?.treatment).toBe("GENERATE");
    } finally {
      await jobs.cancel(queued.jobId);
    }
  });

  it("still proves ABSENT for an ENHANCEMENT of a completed empty-room photo", async () => {
    const photo = await prisma.mediaAsset.create({
      data: {
        projectId,
        kind: "PHOTO",
        filename: "empty-room-enhance.png",
        mimeType: "image/png",
        byteSize: 8,
        storageKey: `pr6-mf2/${projectId}/empty-room-enhance`,
        status: "READY",
        analysisStatus: "COMPLETED",
      },
    });
    await prisma.mediaAnalysis.create({
      data: {
        assetId: photo.id,
        providerKey: "test.analysis",
        schemaVersion: "1.0",
        status: "COMPLETED",
        payload: {
          analysisSchemaVersion: "1.0",
          people: { count: 0, people: [], recurringPersonIds: [] },
        } as Prisma.InputJsonValue,
      },
    });
    const { assets } = harness({
      adapter: scriptedGenerator(async () => {
        throw new Error("stop after cues");
      }),
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await assets.requestGenerate(ownerId, projectId, {
      roles: [
        {
          role: "room_enhance",
          storySceneId: "scene-arrive",
          kind: "ENHANCEMENT",
          sourceMediaAssetId: photo.id,
        },
      ],
    });
    try {
      const job = await jobs.get(queued.jobId);
      await expect(assets.processJob(job!)).rejects.toThrow("stop after cues");
      const slot = await prisma.shotFulfillment.findFirst({
        where: { projectId, role: "room_enhance", storySceneId: "scene-arrive" },
      });
      expect(slot?.identityState).toBe("ABSENT");
      expect(slot?.scope).toBe("NON_IDENTITY");
      expect(slot?.requiredScopes).toEqual(["NON_IDENTITY"]);
      expect(slot?.shotRole).toBe("other");
      expect(slot?.identityEvidence).toEqual({
        faceCount: 0,
        faceDetected: false,
        recurringPersonCount: 0,
        analysisCompleted: true,
      });
    } finally {
      await jobs.cancel(queued.jobId);
    }
  });

  it("does not prove ABSENT for an ENHANCEMENT whose people section is extended or unversioned", async () => {
    const cases = [
      {
        role: "proof_face_count",
        payload: {
          analysisSchemaVersion: "1.0",
          people: { count: 0, people: [], recurringPersonIds: [], faceCount: 2 },
        },
      },
      {
        role: "proof_faces",
        payload: {
          analysisSchemaVersion: "1.0",
          people: { count: 0, people: [], recurringPersonIds: [], faces: [{}] },
        },
      },
      {
        role: "proof_persons",
        payload: {
          analysisSchemaVersion: "1.0",
          people: { count: 0, people: [], recurringPersonIds: [], persons: 1 },
        },
      },
      {
        role: "proof_notes",
        payload: {
          analysisSchemaVersion: "1.0",
          people: { count: 0, people: [], recurringPersonIds: [], notes: "a woman partly visible" },
        },
      },
      {
        role: "proof_no_version",
        payload: { people: { count: 0, people: [], recurringPersonIds: [] } },
      },
    ];
    const { assets } = harness({
      adapter: scriptedGenerator(async () => {
        throw new Error("stop after cues");
      }),
      productionAvailable: false,
      localDevAvailable: true,
    });
    for (const item of cases) {
      const photo = await prisma.mediaAsset.create({
        data: {
          projectId,
          kind: "PHOTO",
          filename: `${item.role}.png`,
          mimeType: "image/png",
          byteSize: 8,
          storageKey: `pr6-r2/${projectId}/${item.role}`,
          status: "READY",
          analysisStatus: "COMPLETED",
        },
      });
      await prisma.mediaAnalysis.create({
        data: {
          assetId: photo.id,
          providerKey: "test.analysis",
          schemaVersion: "1.0",
          status: "COMPLETED",
          payload: item.payload as Prisma.InputJsonValue,
        },
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [
          {
            role: item.role,
            storySceneId: "scene-arrive",
            kind: "ENHANCEMENT",
            sourceMediaAssetId: photo.id,
          },
        ],
      });
      try {
        const job = await jobs.get(queued.jobId);
        await expect(assets.processJob(job!)).rejects.toThrow("stop after cues");
        const slot = await prisma.shotFulfillment.findFirst({
          where: { projectId, role: item.role, storySceneId: "scene-arrive" },
        });
        expect(slot?.identityState).toBe("UNKNOWN");
        expect(slot?.scope).toBe("IDENTITY");
        expect(slot?.requiredScopes).toEqual(["IDENTITY"]);
        expect(slot?.shotRole).toBe("other");
        expect(slot?.identityEvidence).toEqual({
          faceCount: 0,
          faceDetected: false,
          recurringPersonCount: 0,
          analysisCompleted: false,
        });
      } finally {
        await jobs.cancel(queued.jobId);
      }
    }
  });

  it("does not generate, reserve, or open a slot when cue extraction throws", async () => {
    let generateCalls = 0;
    const { assets } = harness({
      adapter: scriptedGenerator(async () => {
        generateCalls += 1;
        throw new Error("generated");
      }),
      productionAvailable: false,
      localDevAvailable: true,
      collectCues: async () => {
        throw new Error("cue read failed");
      },
    });
    const queued = await assets.requestGenerate(ownerId, projectId, {
      roles: [{ role: "cue_throw_still", storySceneId: "scene-arrive", kind: "IMAGE" }],
    });
    try {
      const job = await jobs.get(queued.jobId);
      await expect(assets.processJob(job!)).rejects.toThrow("cue read failed");
      expect(generateCalls).toBe(0);
      expect(
        await prisma.shotFulfillment.count({
          where: { projectId, role: "cue_throw_still" },
        }),
      ).toBe(0);
      expect(await prisma.shotFulfillmentAttempt.count({ where: { jobId: queued.jobId } })).toBe(0);
      expect(await prisma.usageEvent.count({ where: { jobId: queued.jobId } })).toBe(0);
      expect(
        await prisma.aiVideoBudgetReservation.count({
          where: { idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
        }),
      ).toBe(0);
      const after = await jobs.get(queued.jobId);
      expect(after?.attempts).toBe(0);
      expect(after?.status).toBe(JobStatus.PENDING);
    } finally {
      await jobs.cancel(queued.jobId);
    }
  });

  it("loads scene emphasis once and passes that same list to every role", async () => {
    const seen: unknown[] = [];
    const { assets } = harness({
      adapter: new LocalDeterministicAssetGenerator(storage),
      productionAvailable: false,
      localDevAvailable: true,
      collectCues: async (db, args) => {
        seen.push(args.sceneEmphasis);
        return collectShotCueInput(db, args);
      },
    });
    const queued = await assets.requestGenerate(ownerId, projectId, {
      roles: [
        { role: "plan_once_wide", storySceneId: "scene-arrive", kind: "IMAGE" },
        { role: "plan_once_tight", storySceneId: "scene-arrive", kind: "IMAGE" },
      ],
    });
    const job = await jobs.get(queued.jobId);
    await assets.processJob(job!);
    await jobs.complete(queued.jobId, { assetIds: [] });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(Array.isArray(seen[0])).toBe(true);
    const slots = await prisma.shotFulfillment.findMany({
      where: { projectId, role: { in: ["plan_once_wide", "plan_once_tight"] } },
    });
    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      expect(slot.shotRole).toBe("other");
      expect(slot.identityEvidence).toEqual({
        faceCount: 0,
        faceDetected: false,
        recurringPersonCount: 0,
        analysisCompleted: false,
      });
    }
    const finished = await jobs.get(queued.jobId);
    expect(finished?.status).toBe(JobStatus.SUCCEEDED);
  });

  it("does not generate a dialogue close-up in LEGACY or ENFORCED", async () => {
    const story = await prisma.storyStructure.findFirstOrThrow({
      where: { projectId, status: StoryStructureStatus.READY },
    });
    const original = story.payload;
    const document = structuredClone(original) as StoryDocument;
    document.acts[0]!.scenes[0]!.dialogueOutline = "They say hello.";
    const previousMode = process.env.SG_ROUTING_MODE;
    const previousLane = process.env.YF_GATEWAY_LANE_ID;
    process.env.YF_GATEWAY_LANE_ID = "r1-wan27-replicate";
    await prisma.storyStructure.update({
      where: { id: story.id },
      data: { payload: document as Prisma.InputJsonValue },
    });
    try {
      for (const mode of ["LEGACY", "ENFORCED"] as const) {
        if (mode === "LEGACY") delete process.env.SG_ROUTING_MODE;
        else process.env.SG_ROUTING_MODE = mode;
        const calls: string[] = [];
        let laneCalls = 0;
        const { assets, worker } = harness({
          adapter: scriptedGenerator(async () => {
            calls.push("generate");
            throw new Error("dialogue must not generate");
          }),
          productionAvailable: true,
          localDevAvailable: true,
          resolveLanes: () => ({
            forLane() {
              laneCalls += 1;
              throw new Error("dialogue must not resolve a lane");
            },
            processors() {
              return [];
            },
          }),
        });
        const queued = await assets.requestGenerate(ownerId, projectId, {
          roles: [{ role: "dialogue_hold", storySceneId: "scene-arrive", kind: "IMAGE" }],
        });
        await worker.processNext();
        expect(calls, mode).toEqual([]);
        expect(laneCalls, mode).toBe(0);
        const slot = await prisma.shotFulfillment.findFirst({
          where: { projectId, role: "dialogue_hold", storySceneId: "scene-arrive" },
          orderBy: { createdAt: "desc" },
        });
        expect(slot?.treatment, mode).toBe("DEFER");
        expect(slot?.status, mode).toBe("DEFERRED");
        expect(slot?.userMessageKey, mode).toBe("SG_WAITING");
        expect(slot?.routingMode, mode).toBe(mode);
        expect(
          await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot?.id } }),
        ).toBe(0);
        expect(
          await prisma.aiVideoBudgetReservation.count({
            where: { idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
          }),
        ).toBe(0);
        expect((await jobs.get(queued.jobId))?.status).toBe(JobStatus.SUCCEEDED);
      }
    } finally {
      await prisma.storyStructure.update({
        where: { id: story.id },
        data: { payload: original as Prisma.InputJsonValue },
      });
      if (previousMode === undefined) delete process.env.SG_ROUTING_MODE;
      else process.env.SG_ROUTING_MODE = previousMode;
      if (previousLane === undefined) delete process.env.YF_GATEWAY_LANE_ID;
      else process.env.YF_GATEWAY_LANE_ID = previousLane;
    }
  });

  it("makes zero generation calls in ENFORCED when nothing is QUALIFIED", async () => {
    const previousMode = process.env.SG_ROUTING_MODE;
    process.env.SG_ROUTING_MODE = "ENFORCED";
    const calls: string[] = [];
    let laneCalls = 0;
    try {
      const { assets, worker } = harness({
        adapter: scriptedGenerator(async () => {
          calls.push("generate");
          throw new Error("enforced must not generate");
        }),
        productionAvailable: false,
        localDevAvailable: true,
        resolveLanes: () => ({
          forLane() {
            laneCalls += 1;
            throw new Error("enforced must not resolve a lane");
          },
          processors() {
            return [];
          },
        }),
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "broll_motion", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
      });
      await worker.processNext();
      expect((await jobs.get(queued.jobId))?.status).toBe(JobStatus.SUCCEEDED);
      expect(calls).toEqual([]);
      expect(laneCalls).toBe(0);
      const slot = await prisma.shotFulfillment.findFirstOrThrow({
        where: { projectId, role: "broll_motion" },
      });
      expect(slot.treatment).toBe("DEFER");
      expect(slot.status).toBe("DEFERRED");
      expect(slot.userMessageKey).toBe("SG_NO_QUALIFIED_LANE");
      expect(slot.routingMode).toBe("ENFORCED");
      expect(await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot.id } })).toBe(0);
    } finally {
      if (previousMode === undefined) delete process.env.SG_ROUTING_MODE;
      else process.env.SG_ROUTING_MODE = previousMode;
    }
  });

  const EMPTY_ROOM = {
    analysisSchemaVersion: "1.0",
    people: { count: 0, people: [], recurringPersonIds: [] },
  };
  const EXTRA_ROOT_ROOM = { ...EMPTY_ROOM, extraRoot: true };

  function qualifiedLaneFile(gateway: { baseUrlEnv: string; apiKeyEnv: string }) {
    const gate = {
      status: "QUALIFIED",
      evidenceSha256: "ab".repeat(32),
      signoffRef: "po-signoff:fixture",
    };
    return {
      registryVersion: "sg-lanes-v1",
      thresholdsVersion: "po-sg-2026-09-25",
      regenCeilings: { "draft-cost": 3, "draft-quality": 2, standard: 2, premium: 2 },
      classOrder: ["draft-cost", "draft-quality", "standard", "premium"],
      lanes: [
        {
          laneId: "veo31lite-720",
          laneClass: "draft-quality",
          providerKey: "open:veo-lite",
          modelId: "open-veo-lite",
          gateway,
          resolutionTier: "720p",
          usdPerSecond: 0.05,
          rateRef: "ESTIMATE fixture; not a price",
          clipDurationS: 5,
          supportedDurationsS: [5],
          billingGranularityS: 1,
          failuresBillable: true,
          audioMode: "OFF",
          enabled: true,
          designation: "NONE",
          gates: { HERO: gate, IDENTITY: gate, NON_IDENTITY: gate },
        },
      ],
      processors: [],
    };
  }

  async function writeQualifiedRegistry(gateway?: { baseUrlEnv: string; apiKeyEnv: string }) {
    const dir = await mkdtemp(path.join(tmpdir(), "youflicks-pr8-review-"));
    const file = path.join(dir, "lanes.json");
    await writeFile(
      file,
      JSON.stringify(
        qualifiedLaneFile(
          gateway ?? {
            baseUrlEnv: "SG_LANE_VEO_LITE_BASE_URL",
            apiKeyEnv: "SG_LANE_VEO_LITE_API_KEY",
          },
        ),
      ),
      "utf8",
    );
    return { dir, file };
  }

  const QUALIFIED_GATE = {
    status: "QUALIFIED",
    evidenceSha256: "ab".repeat(32),
    signoffRef: "po-signoff:fixture",
  };
  const UNQUALIFIED_GATE = { status: "NOT_QUALIFIED" };

  function fixtureLane(input: {
    laneId: string;
    laneClass: string;
    providerKey: string;
    modelId: string;
    usdPerSecond: number;
    gateway: { baseUrlEnv: string; apiKeyEnv: string };
    gates: { HERO: object; IDENTITY: object; NON_IDENTITY: object };
    designation?: string;
  }) {
    return {
      laneId: input.laneId,
      laneClass: input.laneClass,
      providerKey: input.providerKey,
      modelId: input.modelId,
      gateway: input.gateway,
      resolutionTier: "720p",
      usdPerSecond: input.usdPerSecond,
      rateRef: "ESTIMATE fixture; not a price",
      clipDurationS: 5,
      supportedDurationsS: [5],
      billingGranularityS: 1,
      failuresBillable: true,
      audioMode: "OFF",
      enabled: true,
      designation: input.designation ?? "NONE",
      gates: input.gates,
    };
  }

  async function writeLaneRegistry(lanes: object[]) {
    const dir = await mkdtemp(path.join(tmpdir(), "youflicks-pr8-r2-"));
    const file = path.join(dir, "lanes.json");
    await writeFile(
      file,
      JSON.stringify({
        registryVersion: "sg-lanes-v1",
        thresholdsVersion: "po-sg-2026-09-25",
        regenCeilings: { "draft-cost": 3, "draft-quality": 2, standard: 2, premium: 2 },
        classOrder: ["draft-cost", "draft-quality", "standard", "premium"],
        lanes,
        processors: [],
      }),
      "utf8",
    );
    return { dir, file };
  }

  async function clearBudgetLedgers() {
    await prisma.aiVideoBudgetLedger.deleteMany({
      where: { OR: [{ projectId }, { userId: ownerId }] },
    });
  }

  async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(values)) {
      previous.set(key, process.env[key]);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      await run();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  async function withDialogueOutline(run: () => Promise<void>) {
    const story = await prisma.storyStructure.findFirstOrThrow({
      where: { projectId, status: StoryStructureStatus.READY },
    });
    const original = story.payload;
    const document = structuredClone(original) as StoryDocument;
    document.acts[0]!.scenes[0]!.dialogueOutline = "They say hello.";
    await prisma.storyStructure.update({
      where: { id: story.id },
      data: { payload: document as Prisma.InputJsonValue },
    });
    try {
      await run();
    } finally {
      await prisma.storyStructure.update({
        where: { id: story.id },
        data: { payload: original as Prisma.InputJsonValue },
      });
    }
  }

  async function seedAnalyzedPhoto(name: string, analysisStatus: string, payload: object | null) {
    const photo = await prisma.mediaAsset.create({
      data: {
        projectId,
        kind: "PHOTO",
        filename: `${name}.png`,
        mimeType: "image/png",
        byteSize: 8,
        storageKey: `pr8-review/${projectId}/${name}`,
        status: "READY",
        analysisStatus,
      },
    });
    if (payload) {
      await prisma.mediaAnalysis.create({
        data: {
          assetId: photo.id,
          providerKey: "test.analysis",
          schemaVersion: "1.0",
          status: "COMPLETED",
          payload: payload as Prisma.InputJsonValue,
        },
      });
    }
    return photo;
  }

  function spendSpy(events: string[]): AiVideoBudgetPort {
    const inner = new PrismaAiVideoBudget(prisma);
    return new Proxy(inner, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "reserve" || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          try {
            return await value.apply(target, args);
          } finally {
            events.push("reserve");
          }
        };
      },
    });
  }

  function routedLane(input: {
    events: string[];
    adapter: AssetGeneratorPort;
    modelId?: string;
    supportedCapabilities?: AssetCapabilityValue[];
  }) {
    return () => ({
      forLane() {
        input.events.push("forLane");
        return {
          adapter: input.adapter,
          attribution(capability: AssetCapabilityValue): AssetExecutionAttribution {
            return {
              providerKey: "open:veo-lite",
              capability,
              modelId: input.modelId ?? "open-veo-lite",
              modelVersion: "1",
            };
          },
          supportedCapabilities: input.supportedCapabilities ?? [
            AssetCapability.IMAGE_GENERATION,
            AssetCapability.VIDEO_GENERATION,
            AssetCapability.MEDIA_ENHANCEMENT,
          ],
        };
      },
      processors() {
        return [];
      },
    });
  }

  async function finishQuietly(jobId: string) {
    const current = await jobs.get(jobId);
    if (
      current &&
      current.status !== JobStatus.SUCCEEDED &&
      current.status !== JobStatus.FAILED &&
      current.status !== JobStatus.CANCELLED
    ) {
      await jobs.cancel(jobId);
    }
  }

  async function expectNoPaidAttempt(jobId: string) {
    expect(await prisma.shotFulfillmentAttempt.count({ where: { jobId } })).toBe(0);
    expect(
      await prisma.aiVideoBudgetReservation.count({
        where: { idempotencyKey: { startsWith: `asset:${jobId}:` } },
      }),
    ).toBe(0);
  }

  it("AP1 does not generate an enhancement whose empty-room analysis has an extra root key", async () => {
    const registry = await writeQualifiedRegistry();
    await withDialogueOutline(async () => {
      await withEnv(
        {
          YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
          SG_LANE_REGISTRY_PATH: registry.file,
          SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
          SG_LANE_VEO_LITE_API_KEY: "test-key",
        },
        async () => {
          const previousMode = process.env.SG_ROUTING_MODE;
          try {
          for (const mode of ["LEGACY", "ENFORCED"] as const) {
            if (mode === "LEGACY") delete process.env.SG_ROUTING_MODE;
            else process.env.SG_ROUTING_MODE = "ENFORCED";
            const photo = await seedAnalyzedPhoto(`ap1-${mode}`, "COMPLETED", EXTRA_ROOT_ROOM);
            const events: string[] = [];
            const { assets } = harness({
              adapter: scriptedGenerator(async () => {
                events.push("generate");
                throw new Error("AP1 must not generate");
              }),
              productionAvailable: true,
              probeHealth: async () => true,
              resolveLanes: routedLane({
                events,
                adapter: scriptedGenerator(async () => {
                  events.push("generate");
                  throw new Error("AP1 must not generate");
                }),
              }),
            });
            const queued = await assets.requestGenerate(ownerId, projectId, {
              roles: [
                {
                  role: `ap1_extra_${mode}`,
                  storySceneId: "scene-arrive",
                  kind: "ENHANCEMENT",
                  sourceMediaAssetId: photo.id,
                },
              ],
            });
            try {
              const job = await jobs.get(queued.jobId);
              await assets.processJob(job!);
              await jobs.complete(queued.jobId, {});
              expect(events, mode).toEqual([]);
              await expectNoPaidAttempt(queued.jobId);
              const slot = await prisma.shotFulfillment.findFirstOrThrow({
                where: { projectId, role: `ap1_extra_${mode}` },
              });
              expect(slot.treatment, mode).toBe("DEFER");
              expect(slot.userMessageKey, mode).toBe("SG_WAITING");
            } finally {
              await finishQuietly(queued.jobId);
            }
          }
          } finally {
            if (previousMode === undefined) delete process.env.SG_ROUTING_MODE;
            else process.env.SG_ROUTING_MODE = previousMode;
          }
        },
      );
    });
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("does not generate a dialogue close-up when the analyzed frame is not the sent frame", async () => {
    const registry = await writeQualifiedRegistry();
    await withDialogueOutline(async () => {
      await withEnv(
        {
          YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
          SG_LANE_REGISTRY_PATH: registry.file,
          SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
          SG_LANE_VEO_LITE_API_KEY: "test-key",
        },
        async () => {
          const previousMode = process.env.SG_ROUTING_MODE;
          try {
          for (const mode of ["LEGACY", "ENFORCED"] as const) {
            if (mode === "LEGACY") delete process.env.SG_ROUTING_MODE;
            else process.env.SG_ROUTING_MODE = "ENFORCED";
            const photo = await seedAnalyzedPhoto(`frame-${mode}`, "COMPLETED", EMPTY_ROOM);
            const events: string[] = [];
            const { assets } = harness({
              adapter: scriptedGenerator(async () => {
                events.push("generate");
                throw new Error("frame mismatch must not generate");
              }),
              productionAvailable: true,
              probeHealth: async () => true,
              collectCues: async (db, args) => {
                const input = await collectShotCueInput(db, args);
                return { ...input, analyzedAssetId: "not-the-sent-frame" };
              },
              resolveLanes: routedLane({
                events,
                adapter: scriptedGenerator(async () => {
                  events.push("generate");
                  throw new Error("frame mismatch must not generate");
                }),
              }),
            });
            const queued = await assets.requestGenerate(ownerId, projectId, {
              roles: [
                {
                  role: `frame_mismatch_${mode}`,
                  storySceneId: "scene-arrive",
                  kind: "ENHANCEMENT",
                  sourceMediaAssetId: photo.id,
                },
              ],
            });
            try {
              const job = await jobs.get(queued.jobId);
              await assets.processJob(job!);
              await jobs.complete(queued.jobId, {});
              expect(events, mode).toEqual([]);
              await expectNoPaidAttempt(queued.jobId);
            } finally {
              await finishQuietly(queued.jobId);
            }
          }
          } finally {
            if (previousMode === undefined) delete process.env.SG_ROUTING_MODE;
            else process.env.SG_ROUTING_MODE = previousMode;
          }
        },
      );
    });
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("AP3 does not generate a stored dialogue-closeup slot after the room analysis completes", async () => {
    const registry = await writeQualifiedRegistry();
    await withDialogueOutline(async () => {
      await withEnv(
        {
          YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
          SG_LANE_REGISTRY_PATH: registry.file,
          SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
          SG_LANE_VEO_LITE_API_KEY: "test-key",
        },
        async () => {
          const previousMode = process.env.SG_ROUTING_MODE;
          try {
          for (const mode of ["LEGACY", "ENFORCED"] as const) {
            if (mode === "LEGACY") delete process.env.SG_ROUTING_MODE;
            else process.env.SG_ROUTING_MODE = "ENFORCED";
            const role = `ap3_stored_${mode}`;
            const photo = await seedAnalyzedPhoto(`ap3-${mode}`, "PROCESSING", null);
            const events: string[] = [];
            const harnessFor = () =>
              harness({
                adapter: scriptedGenerator(async () => {
                  events.push("generate");
                  throw new Error("AP3 must not generate");
                }),
                productionAvailable: true,
                probeHealth: async () => true,
                resolveLanes: routedLane({
                  events,
                  adapter: scriptedGenerator(async () => {
                    events.push("generate");
                    throw new Error("AP3 must not generate");
                  }),
                }),
              });
            const first = harnessFor();
            const queued = await first.assets.requestGenerate(ownerId, projectId, {
              roles: [
                {
                  role,
                  storySceneId: "scene-arrive",
                  kind: "ENHANCEMENT",
                  sourceMediaAssetId: photo.id,
                },
              ],
            });
            try {
              await first.assets.processJob((await jobs.get(queued.jobId))!);
              await jobs.complete(queued.jobId, {});
              const stored = await prisma.shotFulfillment.findFirstOrThrow({
                where: { projectId, role },
              });
              expect(stored.shotRole, mode).toBe("dialogue-closeup");
              expect(stored.identityState, mode).toBe("UNKNOWN");
              await prisma.mediaAsset.update({
                where: { id: photo.id },
                data: { analysisStatus: "COMPLETED" },
              });
              await prisma.mediaAnalysis.create({
                data: {
                  assetId: photo.id,
                  providerKey: "test.analysis",
                  schemaVersion: "1.0",
                  status: "COMPLETED",
                  payload: EMPTY_ROOM as Prisma.InputJsonValue,
                },
              });
              const second = harnessFor();
              const again = await second.assets.requestGenerate(ownerId, projectId, {
                roles: [
                  {
                    role,
                    storySceneId: "scene-arrive",
                    kind: "ENHANCEMENT",
                    sourceMediaAssetId: photo.id,
                  },
                ],
              });
              await second.assets.processJob((await jobs.get(again.jobId))!);
              await jobs.complete(again.jobId, {});
              expect(events, mode).toEqual([]);
              await expectNoPaidAttempt(queued.jobId);
              await expectNoPaidAttempt(again.jobId);
              const slot = await prisma.shotFulfillment.findFirstOrThrow({
                where: { projectId, role },
              });
              expect(slot.shotRole, mode).toBe("dialogue-closeup");
              expect(slot.treatment, mode).toBe("DEFER");
            } finally {
              await finishQuietly(queued.jobId);
            }
          }
          } finally {
            if (previousMode === undefined) delete process.env.SG_ROUTING_MODE;
            else process.env.SG_ROUTING_MODE = previousMode;
          }
        },
      );
    });
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("AP4 prices the ENFORCED hold from the routed lane before forLane", async () => {
    const registry = await writeQualifiedRegistry();
    const events: string[] = [];
    const local = new LocalDeterministicAssetGenerator(storage);
    let jobId = "";
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
      },
      async () => {
        const { assets } = harness({
          adapter: scriptedGenerator(async () => {
            throw new Error("injected adapter must not run");
          }),
          productionAvailable: true,
          probeHealth: async () => true,
          budgets: spendSpy(events),
          resolveLanes: routedLane({
            events,
            adapter: {
              async generate(input) {
                const hold = await prisma.aiVideoBudgetReservation.findFirst({
                  where: { idempotencyKey: { startsWith: `asset:${jobId}:` } },
                });
                expect(hold?.status).toBe("RESERVED");
                expect(hold?.laneId).toBe("veo31lite-720");
                expect(hold?.usdPerSecond).toBe(0.05);
                events.push("generate");
                return local.generate(input);
              },
            },
          }),
        });
        const queued = await assets.requestGenerate(ownerId, projectId, {
          roles: [{ role: "routed_hold_still", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
        });
        jobId = queued.jobId;
        try {
          await assets.processJob((await jobs.get(queued.jobId))!);
          await jobs.complete(queued.jobId, {});
          expect(events).toEqual(["reserve", "forLane", "generate"]);
          const reservation = await prisma.aiVideoBudgetReservation.findFirstOrThrow({
            where: { idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
          });
          expect(reservation.laneId).toBe("veo31lite-720");
          expect(reservation.providerKey).toBe("open:veo-lite");
          expect(reservation.usdPerSecond).toBe(0.05);
          expect(reservation.estimatedBilledSeconds).toBe(5);
          expect(reservation.estimatedUsd).toBeCloseTo(0.25, 5);
          expect(reservation.laneId).not.toBe("r1-wan27-replicate");
          const attempt = await prisma.shotFulfillmentAttempt.findFirstOrThrow({
            where: { jobId: queued.jobId },
          });
          expect(attempt.laneId).toBe("veo31lite-720");
          expect(attempt.usdPerSecond).toBe(0.05);
          expect(attempt.budgetReservationId).toBe(reservation.id);
        } finally {
          await finishQuietly(queued.jobId);
          await prisma.aiVideoBudgetLedger.deleteMany({
            where: { OR: [{ projectId }, { userId: ownerId }] },
          });
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("AP12 does not generate in ENFORCED without a hold when the gateway lane env is unset", async () => {
    const registry = await writeQualifiedRegistry();
    const events: string[] = [];
    const local = new LocalDeterministicAssetGenerator(storage);
    let jobId = "";
    let holdAtGenerate: { laneId: string; usdPerSecond: number } | null = null;
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        YF_GATEWAY_LANE_ID: undefined,
        SG_BUDGET_PROJECT_MAX_SECONDS: undefined,
        SG_BUDGET_PROJECT_MAX_USD: undefined,
        SG_BUDGET_USER_WINDOW_MAX_SECONDS: undefined,
        SG_BUDGET_USER_WINDOW_MAX_USD: undefined,
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
      },
      async () => {
        const { assets } = harness({
          adapter: scriptedGenerator(async () => {
            events.push("injected");
            throw new Error("injected adapter must not run");
          }),
          productionAvailable: true,
          probeHealth: async () => true,
          budgets: spendSpy(events),
          resolveLanes: routedLane({
            events,
            adapter: {
              async generate(input) {
                const hold = await prisma.aiVideoBudgetReservation.findFirst({
                  where: { idempotencyKey: { startsWith: `asset:${jobId}:` } },
                });
                holdAtGenerate = hold
                  ? { laneId: hold.laneId, usdPerSecond: hold.usdPerSecond }
                  : null;
                events.push("generate");
                return local.generate(input);
              },
            },
          }),
        });
        const queued = await assets.requestGenerate(ownerId, projectId, {
          roles: [{ role: "unset_lane_hold_still", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
        });
        jobId = queued.jobId;
        try {
          await assets.processJob((await jobs.get(queued.jobId))!);
          await jobs.complete(queued.jobId, {});
          expect(events).toEqual(["reserve", "forLane", "generate"]);
          expect(holdAtGenerate).toEqual({ laneId: "veo31lite-720", usdPerSecond: 0.05 });
          const attempt = await prisma.shotFulfillmentAttempt.findFirstOrThrow({
            where: { jobId: queued.jobId },
          });
          expect(attempt.budgetReservationId).not.toBeNull();
        } finally {
          await finishQuietly(queued.jobId);
          await prisma.aiVideoBudgetLedger.deleteMany({
            where: { OR: [{ projectId }, { userId: ownerId }] },
          });
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("M18 releases the hold when the resolved model does not match the registry", async () => {
    const registry = await writeQualifiedRegistry();
    const events: string[] = [];
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
      },
      async () => {
        const { assets } = harness({
          adapter: scriptedGenerator(async () => {
            events.push("generate");
            throw new Error("model mismatch must not generate");
          }),
          productionAvailable: true,
          probeHealth: async () => true,
          budgets: spendSpy(events),
          resolveLanes: routedLane({
            events,
            modelId: "wrong-model",
            adapter: scriptedGenerator(async () => {
              events.push("generate");
              throw new Error("model mismatch must not generate");
            }),
          }),
        });
        const queued = await assets.requestGenerate(ownerId, projectId, {
          roles: [{ role: "model_mismatch_still", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
        });
        try {
          await assets.processJob((await jobs.get(queued.jobId))!);
          await jobs.complete(queued.jobId, {});
          expect(events).toEqual(["reserve", "forLane"]);
          const reservation = await prisma.aiVideoBudgetReservation.findFirstOrThrow({
            where: { idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
          });
          expect(reservation.status).toBe("RELEASED");
          expect(reservation.settleReason).toBe("GATEWAY_NONE");
          const slot = await prisma.shotFulfillment.findFirstOrThrow({
            where: { projectId, role: "model_mismatch_still" },
          });
          expect(slot.treatment).toBe("FAIL_HONEST");
          expect(await prisma.shotFulfillmentAttempt.count({ where: { jobId: queued.jobId } })).toBe(0);
        } finally {
          await finishQuietly(queued.jobId);
          await prisma.aiVideoBudgetLedger.deleteMany({
            where: { OR: [{ projectId }, { userId: ownerId }] },
          });
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("M26 does not generate a later ENFORCED job after CAP_DENIED", async () => {
    const registry = await writeQualifiedRegistry();
    const events: string[] = [];
    const previousSeconds = process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
    process.env.SG_BUDGET_PROJECT_MAX_SECONDS = "1";
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        YF_GATEWAY_LANE_ID: undefined,
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
      },
      async () => {
        const role = "cap_stop_still";
        const build = () =>
          harness({
            adapter: scriptedGenerator(async () => {
              events.push("generate");
              throw new Error("cap must not generate");
            }),
            productionAvailable: true,
            probeHealth: async () => true,
            budgets: spendSpy(events),
            resolveLanes: routedLane({
              events,
              adapter: scriptedGenerator(async () => {
                events.push("generate");
                throw new Error("cap must not generate");
              }),
            }),
          });
        const first = build();
        const queued = await first.assets.requestGenerate(ownerId, projectId, {
          roles: [{ role, storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
        });
        try {
          await expect(first.assets.processJob((await jobs.get(queued.jobId))!)).rejects.toThrow(/cap/i);
          await jobs.fail(queued.jobId, { error: "cap", retry: false });
          expect(events).toEqual(["reserve"]);
          const attempt = await prisma.shotFulfillmentAttempt.findFirstOrThrow({
            where: { jobId: queued.jobId },
          });
          expect(attempt.outcome).toBe("CAP_DENIED");
          expect((await jobs.get(queued.jobId))?.status).toBe(JobStatus.FAILED);
          delete process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
          await prisma.aiVideoBudgetLedger.deleteMany({
            where: { OR: [{ projectId }, { userId: ownerId }] },
          });
          const second = build();
          const again = await second.assets.requestGenerate(ownerId, projectId, {
            roles: [{ role, storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
          });
          await second.assets.processJob((await jobs.get(again.jobId))!);
          await jobs.complete(again.jobId, {});
          expect(events).toEqual(["reserve"]);
          const slot = await prisma.shotFulfillment.findFirstOrThrow({
            where: { projectId, role },
          });
          expect(slot.userMessageKey).toBe("SG_CAP_REACHED");
          expect(slot.treatment).toBe("DEFER");
          await expectNoPaidAttempt(again.jobId);
        } finally {
          if (previousSeconds === undefined) delete process.env.SG_BUDGET_PROJECT_MAX_SECONDS;
          else process.env.SG_BUDGET_PROJECT_MAX_SECONDS = previousSeconds;
          await finishQuietly(queued.jobId);
          await prisma.aiVideoBudgetLedger.deleteMany({
            where: { OR: [{ projectId }, { userId: ownerId }] },
          });
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("M08 blocks a second process of the same LEGACY job after a timeout", async () => {
    const previousMode = process.env.SG_ROUTING_MODE;
    delete process.env.SG_ROUTING_MODE;
    const calls: string[] = [];
    const { assets } = harness({
      adapter: scriptedGenerator(async () => {
        calls.push("generate");
        throw new Error("settlement missing");
      }),
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await assets.requestGenerate(ownerId, projectId, {
      roles: [{ role: "legacy_timeout_still", storySceneId: "scene-arrive", kind: "IMAGE" }],
    });
    const job = (await jobs.get(queued.jobId))!;
    try {
      await expect(assets.processJob(job)).rejects.toThrow("settlement missing");
      expect(calls).toEqual(["generate"]);
      const attempt = await prisma.shotFulfillmentAttempt.findFirstOrThrow({
        where: { jobId: queued.jobId },
      });
      expect(attempt.outcome).toBe("TIMEOUT_UNRECONCILED");
      await assets.processJob(job);
      expect(calls).toEqual(["generate"]);
      await jobs.complete(queued.jobId, {});
      const again = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "legacy_timeout_still", storySceneId: "scene-arrive", kind: "IMAGE" }],
      });
      const next = (await jobs.get(again.jobId))!;
      await expect(assets.processJob(next)).rejects.toThrow("settlement missing");
      expect(calls).toEqual(["generate", "generate"]);
      await jobs.cancel(again.jobId);
    } finally {
      await finishQuietly(queued.jobId);
      if (previousMode === undefined) delete process.env.SG_ROUTING_MODE;
      else process.env.SG_ROUTING_MODE = previousMode;
    }
  });

  it("does not probe a health URL the resolver would refuse", async () => {
    const registry = await writeQualifiedRegistry({
      baseUrlEnv: "DATABASE_URL",
      apiKeyEnv: "SG_LANE_SECRET_API_KEY",
    });
    let probes = 0;
    const events: string[] = [];
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        SG_LANE_REGISTRY_PATH: registry.file,
      },
      async () => {
        const { assets } = harness({
          adapter: scriptedGenerator(async () => {
            events.push("generate");
            throw new Error("refused health URL must not generate");
          }),
          productionAvailable: true,
          probeHealth: async (baseUrl) => {
            probes += 1;
            expect(baseUrl).not.toContain("postgres");
            return true;
          },
          resolveLanes: routedLane({
            events,
            adapter: scriptedGenerator(async () => {
              events.push("generate");
              throw new Error("refused health URL must not generate");
            }),
          }),
        });
        const queued = await assets.requestGenerate(ownerId, projectId, {
          roles: [{ role: "database_url_health", storySceneId: "scene-arrive", kind: "IMAGE" }],
        });
        try {
          await assets.processJob((await jobs.get(queued.jobId))!);
          await jobs.complete(queued.jobId, {});
          expect(probes).toBe(0);
          expect(events).toEqual([]);
          const slot = await prisma.shotFulfillment.findFirstOrThrow({
            where: { projectId, role: "database_url_health" },
          });
          expect(slot.treatment).toBe("DEFER");
        } finally {
          await finishQuietly(queued.jobId);
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("records an accurate LEGACY decision reason", async () => {
    const previousMode = process.env.SG_ROUTING_MODE;
    delete process.env.SG_ROUTING_MODE;
    try {
      const { assets } = harness({
        adapter: new LocalDeterministicAssetGenerator(storage),
        productionAvailable: false,
        localDevAvailable: true,
      });
      const queued = await assets.requestGenerate(ownerId, projectId, {
        roles: [{ role: "legacy_reason_still", storySceneId: "scene-arrive", kind: "IMAGE" }],
      });
      await assets.processJob((await jobs.get(queued.jobId))!);
      await jobs.complete(queued.jobId, {});
      const slot = await prisma.shotFulfillment.findFirstOrThrow({
        where: { projectId, role: "legacy_reason_still" },
      });
      expect(slot.decisionReason).toBe("LEGACY routes this role on the injected adapter.");
      expect(slot.routingMode).toBe("LEGACY");
      expect(slot.shadowDecision).not.toBeNull();
      expect(slot.decisionReason).not.toContain("cannot be read");
    } finally {
      if (previousMode === undefined) delete process.env.SG_ROUTING_MODE;
      else process.env.SG_ROUTING_MODE = previousMode;
    }
  });

  it("AP12b reserves the routed lane when the injected adapter is local-dev only", async () => {
    const registry = await writeQualifiedRegistry();
    const events: string[] = [];
    const local = new LocalDeterministicAssetGenerator(storage);
    let jobId = "";
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        YF_GATEWAY_LANE_ID: undefined,
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
        ASSET_ALLOW_LOCAL: "true",
      },
      async () => {
        const { assets } = harness({
          adapter: scriptedGenerator(async () => {
            events.push("injected");
            throw new Error("injected adapter must not run");
          }),
          productionAvailable: false,
          localDevAvailable: true,
          probeHealth: async () => true,
          budgets: spendSpy(events),
          resolveLanes: routedLane({
            events,
            adapter: {
              async generate(input) {
                events.push("generate");
                return local.generate(input);
              },
            },
          }),
        });
        const queued = await assets.requestGenerate(ownerId, projectId, {
          roles: [{ role: "ap12b_local_clip", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
        });
        jobId = queued.jobId;
        try {
          await assets.processJob((await jobs.get(queued.jobId))!);
          await jobs.complete(queued.jobId, {});
          expect(events).toEqual(["reserve", "forLane", "generate"]);
          const reservation = await prisma.aiVideoBudgetReservation.findFirstOrThrow({
            where: { idempotencyKey: { startsWith: `asset:${jobId}:` } },
          });
          expect(reservation.laneId).toBe("veo31lite-720");
          expect(reservation.usdPerSecond).toBe(0.05);
          const attempt = await prisma.shotFulfillmentAttempt.findFirstOrThrow({
            where: { jobId },
          });
          expect(attempt.budgetReservationId).toBe(reservation.id);
        } finally {
          await finishQuietly(queued.jobId);
          await clearBudgetLedgers();
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("AP14 does not book a hold when the role is not a generative video capability", async () => {
    const registry = await writeQualifiedRegistry();
    const events: string[] = [];
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
      },
      async () => {
        const { assets } = harness({
          adapter: scriptedGenerator(async () => {
            events.push("generate");
            throw new Error("AP14 must not generate");
          }),
          productionAvailable: true,
          probeHealth: async () => true,
          budgets: spendSpy(events),
          resolveLanes: routedLane({
            events,
            adapter: scriptedGenerator(async () => {
              events.push("generate");
              throw new Error("AP14 must not generate");
            }),
          }),
        });
        const queued = await assets.requestGenerate(ownerId, projectId, {
          roles: [{ role: "ap14_image", storySceneId: "scene-arrive", kind: "IMAGE" }],
        });
        try {
          await assets.processJob((await jobs.get(queued.jobId))!);
          await jobs.complete(queued.jobId, {});
          expect(events).toEqual([]);
          await expectNoPaidAttempt(queued.jobId);
          const slot = await prisma.shotFulfillment.findFirstOrThrow({
            where: { projectId, role: "ap14_image" },
          });
          expect(slot.treatment).toBe("FAIL_HONEST");
          expect(slot.decisionReason).toContain("IMAGE_GENERATION");
        } finally {
          await finishQuietly(queued.jobId);
          await clearBudgetLedgers();
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("releases an ENFORCED hold when the resolved lane lacks the role capability", async () => {
    const registry = await writeQualifiedRegistry();
    const events: string[] = [];
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
      },
      async () => {
        const { assets } = harness({
          adapter: scriptedGenerator(async () => {
            events.push("generate");
            throw new Error("capability mismatch must not generate");
          }),
          productionAvailable: true,
          probeHealth: async () => true,
          budgets: spendSpy(events),
          resolveLanes: routedLane({
            events,
            supportedCapabilities: [AssetCapability.IMAGE_GENERATION],
            adapter: scriptedGenerator(async () => {
              events.push("generate");
              throw new Error("capability mismatch must not generate");
            }),
          }),
        });
        const queued = await assets.requestGenerate(ownerId, projectId, {
          roles: [{ role: "resolved_capability_clip", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
        });
        try {
          await expect(assets.processJob((await jobs.get(queued.jobId))!)).rejects.toThrow(/VIDEO_GENERATION/);
          await jobs.fail(queued.jobId, { error: "capability", retry: false });
          expect(events).toEqual(["reserve", "forLane"]);
          const reservation = await prisma.aiVideoBudgetReservation.findFirstOrThrow({
            where: { idempotencyKey: { startsWith: `asset:${queued.jobId}:` } },
          });
          expect(reservation.status).toBe("RELEASED");
          expect(await prisma.shotFulfillmentAttempt.count({ where: { jobId: queued.jobId } })).toBe(0);
        } finally {
          await finishQuietly(queued.jobId);
          await clearBudgetLedgers();
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("APH does not jump two failed LEGACY standard attempts to premium", async () => {
    const allGates = { HERO: QUALIFIED_GATE, IDENTITY: QUALIFIED_GATE, NON_IDENTITY: QUALIFIED_GATE };
    const none = { HERO: UNQUALIFIED_GATE, IDENTITY: UNQUALIFIED_GATE, NON_IDENTITY: UNQUALIFIED_GATE };
    const registry = await writeLaneRegistry([
      fixtureLane({
        laneId: "r1-wan27-replicate",
        laneClass: "standard",
        providerKey: "open:r1",
        modelId: "r1-model",
        usdPerSecond: 0.1,
        gateway: { baseUrlEnv: "ASSET_HTTP_BASE_URL", apiKeyEnv: "ASSET_HTTP_API_KEY" },
        designation: "LEGACY_R1",
        gates: none,
      }),
      fixtureLane({
        laneId: "veo31lite-720",
        laneClass: "draft-quality",
        providerKey: "open:veo-lite",
        modelId: "open-veo-lite",
        usdPerSecond: 0.05,
        gateway: { baseUrlEnv: "SG_LANE_VEO_LITE_BASE_URL", apiKeyEnv: "SG_LANE_VEO_LITE_API_KEY" },
        gates: allGates,
      }),
      fixtureLane({
        laneId: "seedance2-fast-720",
        laneClass: "premium",
        providerKey: "open:seedance",
        modelId: "open-seedance",
        usdPerSecond: 0.2419,
        gateway: { baseUrlEnv: "SG_LANE_SEEDANCE_BASE_URL", apiKeyEnv: "SG_LANE_SEEDANCE_API_KEY" },
        gates: allGates,
      }),
    ]);
    const local = new LocalDeterministicAssetGenerator(storage);
    const role = "aph_legacy_standard";
    await withEnv(
      {
        SG_ROUTING_MODE: undefined,
        YF_GATEWAY_LANE_ID: "r1-wan27-replicate",
        ASSET_HTTP_MODEL: undefined,
        SG_BUDGET_PROJECT_MAX_SECONDS: undefined,
        SG_BUDGET_PROJECT_MAX_USD: undefined,
        SG_BUDGET_USER_WINDOW_MAX_SECONDS: undefined,
        SG_BUDGET_USER_WINDOW_MAX_USD: undefined,
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
        SG_LANE_SEEDANCE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_SEEDANCE_API_KEY: "test-key",
      },
      async () => {
        try {
          for (let index = 0; index < 2; index += 1) {
            const { assets } = harness({
              adapter: scriptedGenerator(async (input) => {
                const document = await local.generate(input);
                return { ...document, role: "not-the-requested-role" };
              }),
              productionAvailable: true,
              probeHealth: async () => true,
            });
            const queued = await assets.requestGenerate(ownerId, projectId, {
              roles: [{ role, storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
            });
            await expect(assets.processJob((await jobs.get(queued.jobId))!)).rejects.toThrow();
            await jobs.fail(queued.jobId, { error: "rejected", retry: false });
          }
          const slot = await prisma.shotFulfillment.findFirstOrThrow({ where: { projectId, role } });
          const prior = await prisma.shotFulfillmentAttempt.findMany({
            where: { shotFulfillmentId: slot.id },
            orderBy: { attemptNo: "asc" },
          });
          expect(prior.map((row) => row.laneClass)).toEqual(["standard", "standard"]);
          expect(prior.map((row) => row.outcome)).toEqual(["REJECTED_TECHNICAL", "REJECTED_TECHNICAL"]);
          expect(prior[1]?.classAttemptNo).toBe(2);

          process.env.SG_ROUTING_MODE = "ENFORCED";
          const events: string[] = [];
          const laneIds: string[] = [];
          const priced = (record: string[]) => () => ({
            forLane(laneId: string) {
              events.push("forLane");
              record.push(laneId);
              const modelId = laneId === "seedance2-fast-720" ? "open-seedance" : "open-veo-lite";
              return {
                adapter: {
                  async generate(input: Parameters<AssetGeneratorPort["generate"]>[0]) {
                    events.push("generate");
                    return local.generate(input);
                  },
                },
                attribution(capability: AssetCapabilityValue): AssetExecutionAttribution {
                  return {
                    providerKey: laneId === "seedance2-fast-720" ? "open:seedance" : "open:veo-lite",
                    capability,
                    modelId,
                    modelVersion: "1",
                  };
                },
                supportedCapabilities: [AssetCapability.VIDEO_GENERATION],
              };
            },
            processors() {
              return [];
            },
          });
          const { assets } = harness({
            adapter: scriptedGenerator(async () => {
              events.push("injected");
              throw new Error("injected adapter must not run");
            }),
            productionAvailable: true,
            probeHealth: async () => true,
            budgets: spendSpy(events),
            resolveLanes: priced(laneIds),
          });
          const enforced = await assets.requestGenerate(ownerId, projectId, {
            roles: [{ role, storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
          });
          await assets.processJob((await jobs.get(enforced.jobId))!);
          await jobs.complete(enforced.jobId, {});
          expect(events).toEqual(["reserve", "forLane", "generate"]);
          expect(laneIds).toEqual(["veo31lite-720"]);
          const hold = await prisma.aiVideoBudgetReservation.findFirstOrThrow({
            where: { idempotencyKey: { startsWith: `asset:${enforced.jobId}:` } },
          });
          expect(hold.laneId).toBe("veo31lite-720");
          expect(hold.usdPerSecond).toBe(0.05);
          expect(hold.usdPerSecond).not.toBe(0.2419);

          const freshEvents: string[] = [];
          const freshLanes: string[] = [];
          const control = harness({
            adapter: scriptedGenerator(async () => {
              throw new Error("injected adapter must not run");
            }),
            productionAvailable: true,
            probeHealth: async () => true,
            budgets: spendSpy(freshEvents),
            resolveLanes: () => ({
              forLane(laneId: string) {
                freshEvents.push("forLane");
                freshLanes.push(laneId);
                return {
                  adapter: {
                    async generate(input: Parameters<AssetGeneratorPort["generate"]>[0]) {
                      freshEvents.push("generate");
                      return local.generate(input);
                    },
                  },
                  attribution(capability: AssetCapabilityValue): AssetExecutionAttribution {
                    return {
                      providerKey: "open:veo-lite",
                      capability,
                      modelId: "open-veo-lite",
                      modelVersion: "1",
                    };
                  },
                  supportedCapabilities: [AssetCapability.VIDEO_GENERATION],
                };
              },
              processors() {
                return [];
              },
            }),
          });
          const fresh = await control.assets.requestGenerate(ownerId, projectId, {
            roles: [{ role: "aph_fresh_slot", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
          });
          await control.assets.processJob((await jobs.get(fresh.jobId))!);
          await jobs.complete(fresh.jobId, {});
          expect(freshLanes).toEqual(["veo31lite-720"]);
          expect(freshEvents).toEqual(["reserve", "forLane", "generate"]);
        } finally {
          await clearBudgetLedgers();
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("N01 keeps a stored UNKNOWN identity when the fresh room is ABSENT", async () => {
    const registry = await writeLaneRegistry([
      fixtureLane({
        laneId: "draft-only",
        laneClass: "draft-cost",
        providerKey: "open:draft",
        modelId: "open-draft",
        usdPerSecond: 0.01,
        gateway: { baseUrlEnv: "SG_LANE_DRAFT_BASE_URL", apiKeyEnv: "SG_LANE_DRAFT_API_KEY" },
        gates: { HERO: UNQUALIFIED_GATE, IDENTITY: UNQUALIFIED_GATE, NON_IDENTITY: QUALIFIED_GATE },
      }),
    ]);
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_DRAFT_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_DRAFT_API_KEY: "test-key",
      },
      async () => {
        const role = "n01_stored_unknown";
        const photo = await seedAnalyzedPhoto("n01-unknown", "PROCESSING", null);
        const events: string[] = [];
        const build = () =>
          harness({
            adapter: scriptedGenerator(async () => {
              events.push("generate");
              throw new Error("N01 must not generate");
            }),
            productionAvailable: true,
            probeHealth: async () => true,
            resolveLanes: routedLane({
              events,
              modelId: "open-draft",
              adapter: scriptedGenerator(async () => {
                events.push("generate");
                throw new Error("N01 must not generate");
              }),
            }),
          });
        const first = build();
        const queued = await first.assets.requestGenerate(ownerId, projectId, {
          roles: [
            {
              role,
              storySceneId: "scene-arrive",
              kind: "ENHANCEMENT",
              sourceMediaAssetId: photo.id,
            },
          ],
        });
        try {
          await first.assets.processJob((await jobs.get(queued.jobId))!);
          await jobs.complete(queued.jobId, {});
          const stored = await prisma.shotFulfillment.findFirstOrThrow({ where: { projectId, role } });
          expect(stored.identityState).toBe("UNKNOWN");
          expect(stored.requiredScopes).toContain("IDENTITY");
          await prisma.mediaAsset.update({
            where: { id: photo.id },
            data: { analysisStatus: "COMPLETED" },
          });
          await prisma.mediaAnalysis.create({
            data: {
              assetId: photo.id,
              providerKey: "test.analysis",
              schemaVersion: "1.0",
              status: "COMPLETED",
              payload: EMPTY_ROOM as Prisma.InputJsonValue,
            },
          });
          const second = build();
          const again = await second.assets.requestGenerate(ownerId, projectId, {
            roles: [
              {
                role,
                storySceneId: "scene-arrive",
                kind: "ENHANCEMENT",
                sourceMediaAssetId: photo.id,
              },
            ],
          });
          await second.assets.processJob((await jobs.get(again.jobId))!);
          await jobs.complete(again.jobId, {});
          expect(events).toEqual([]);
          await expectNoPaidAttempt(again.jobId);
          const slot = await prisma.shotFulfillment.findFirstOrThrow({ where: { projectId, role } });
          expect(slot.treatment).toBe("DEFER");
          expect(slot.userMessageKey).toBe("SG_NO_QUALIFIED_LANE");
          expect(slot.requiredScopes).toContain("IDENTITY");
        } finally {
          await finishQuietly(queued.jobId);
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("N12 defers before reserve when the project budget flag is blocked", async () => {
    const registry = await writeQualifiedRegistry();
    const local = new LocalDeterministicAssetGenerator(storage);
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        SG_BUDGET_PROJECT_MAX_SECONDS: undefined,
        SG_BUDGET_PROJECT_MAX_USD: undefined,
        SG_BUDGET_USER_WINDOW_MAX_SECONDS: undefined,
        SG_BUDGET_USER_WINDOW_MAX_USD: undefined,
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
      },
      async () => {
        const firstEvents: string[] = [];
        const first = harness({
          adapter: scriptedGenerator(async () => {
            throw new Error("injected adapter must not run");
          }),
          productionAvailable: true,
          probeHealth: async () => true,
          budgets: spendSpy(firstEvents),
          resolveLanes: routedLane({
            events: firstEvents,
            adapter: {
              async generate(input) {
                firstEvents.push("generate");
                return local.generate(input);
              },
            },
          }),
        });
        const opened = await first.assets.requestGenerate(ownerId, projectId, {
          roles: [{ role: "n12_budget_open", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
        });
        try {
          await first.assets.processJob((await jobs.get(opened.jobId))!);
          await jobs.complete(opened.jobId, {});
          expect(firstEvents).toEqual(["reserve", "forLane", "generate"]);
          process.env.SG_BUDGET_PROJECT_MAX_USD = "0.01";
          const blockedEvents: string[] = [];
          const second = harness({
            adapter: scriptedGenerator(async () => {
              blockedEvents.push("generate");
              throw new Error("N12 must not generate");
            }),
            productionAvailable: true,
            probeHealth: async () => true,
            budgets: spendSpy(blockedEvents),
            resolveLanes: routedLane({
              events: blockedEvents,
              adapter: scriptedGenerator(async () => {
                blockedEvents.push("generate");
                throw new Error("N12 must not generate");
              }),
            }),
          });
          const again = await second.assets.requestGenerate(ownerId, projectId, {
            roles: [{ role: "n12_budget_blocked", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
          });
          await second.assets.processJob((await jobs.get(again.jobId))!);
          await jobs.complete(again.jobId, {});
          expect(blockedEvents).toEqual([]);
          await expectNoPaidAttempt(again.jobId);
          const slot = await prisma.shotFulfillment.findFirstOrThrow({
            where: { projectId, role: "n12_budget_blocked" },
          });
          expect(slot.treatment).toBe("DEFER");
          expect(slot.userMessageKey).toBe("SG_CAP_REACHED");
        } finally {
          await finishQuietly(opened.jobId);
          await clearBudgetLedgers();
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("keeps a stored HERO scope when the fresh scene is no longer a hero", async () => {
    const registry = await writeLaneRegistry([
      fixtureLane({
        laneId: "identity-only",
        laneClass: "draft-quality",
        providerKey: "open:identity",
        modelId: "open-identity",
        usdPerSecond: 0.05,
        gateway: { baseUrlEnv: "SG_LANE_IDENTITY_BASE_URL", apiKeyEnv: "SG_LANE_IDENTITY_API_KEY" },
        gates: { HERO: UNQUALIFIED_GATE, IDENTITY: QUALIFIED_GATE, NON_IDENTITY: UNQUALIFIED_GATE },
      }),
    ]);
    const story = await prisma.storyStructure.findFirstOrThrow({
      where: { projectId, status: StoryStructureStatus.READY },
    });
    const original = story.payload;
    const setFunction = async (dramaticFunction: "climax" | "exposition") => {
      const document = structuredClone(original) as StoryDocument;
      document.acts[0]!.scenes[0]!.dramaticFunction = dramaticFunction;
      await prisma.storyStructure.update({
        where: { id: story.id },
        data: { payload: document as Prisma.InputJsonValue },
      });
    };
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_IDENTITY_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_IDENTITY_API_KEY: "test-key",
      },
      async () => {
        const role = "stored_hero_clip";
        const events: string[] = [];
        const build = () =>
          harness({
            adapter: scriptedGenerator(async () => {
              events.push("generate");
              throw new Error("stored HERO must not generate");
            }),
            productionAvailable: true,
            probeHealth: async () => true,
            resolveLanes: routedLane({
              events,
              modelId: "open-identity",
              adapter: scriptedGenerator(async () => {
                events.push("generate");
                throw new Error("stored HERO must not generate");
              }),
            }),
          });
        try {
          await setFunction("climax");
          const first = build();
          const queued = await first.assets.requestGenerate(ownerId, projectId, {
            roles: [{ role, storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
          });
          await first.assets.processJob((await jobs.get(queued.jobId))!);
          await jobs.complete(queued.jobId, {});
          const stored = await prisma.shotFulfillment.findFirstOrThrow({ where: { projectId, role } });
          expect(stored.requiredScopes).toContain("HERO");
          await setFunction("exposition");
          const second = build();
          const again = await second.assets.requestGenerate(ownerId, projectId, {
            roles: [{ role, storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
          });
          await second.assets.processJob((await jobs.get(again.jobId))!);
          await jobs.complete(again.jobId, {});
          expect(events).toEqual([]);
          await expectNoPaidAttempt(again.jobId);
          const slot = await prisma.shotFulfillment.findFirstOrThrow({ where: { projectId, role } });
          expect(slot.requiredScopes).toContain("HERO");
          expect(slot.treatment).toBe("DEFER");
          expect(slot.userMessageKey).toBe("SG_NO_QUALIFIED_LANE");
          await finishQuietly(queued.jobId);
        } finally {
          await prisma.storyStructure.update({
            where: { id: story.id },
            data: { payload: original as Prisma.InputJsonValue },
          });
          await clearBudgetLedgers();
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  it("defers when only the stored dialogue-closeup role still applies", async () => {
    const registry = await writeQualifiedRegistry();
    const story = await prisma.storyStructure.findFirstOrThrow({
      where: { projectId, status: StoryStructureStatus.READY },
    });
    const original = story.payload;
    const writeOutline = async (outline: string) => {
      const document = structuredClone(original) as StoryDocument;
      document.acts[0]!.scenes[0]!.dialogueOutline = outline;
      await prisma.storyStructure.update({
        where: { id: story.id },
        data: { payload: document as Prisma.InputJsonValue },
      });
    };
    await withEnv(
      {
        SG_ROUTING_MODE: "ENFORCED",
        SG_LANE_REGISTRY_PATH: registry.file,
        SG_LANE_VEO_LITE_BASE_URL: "http://127.0.0.1:9",
        SG_LANE_VEO_LITE_API_KEY: "test-key",
      },
      async () => {
        const role = "stored_dialogue_only";
        const photo = await seedAnalyzedPhoto("stored-dialogue", "PROCESSING", null);
        const events: string[] = [];
        const build = () =>
          harness({
            adapter: scriptedGenerator(async () => {
              events.push("generate");
              throw new Error("stored dialogue must not generate");
            }),
            productionAvailable: true,
            probeHealth: async () => true,
            resolveLanes: routedLane({
              events,
              adapter: scriptedGenerator(async () => {
                events.push("generate");
                throw new Error("stored dialogue must not generate");
              }),
            }),
          });
        try {
          await writeOutline("They say hello.");
          const first = build();
          const queued = await first.assets.requestGenerate(ownerId, projectId, {
            roles: [
              {
                role,
                storySceneId: "scene-arrive",
                kind: "ENHANCEMENT",
                sourceMediaAssetId: photo.id,
              },
            ],
          });
          await first.assets.processJob((await jobs.get(queued.jobId))!);
          await jobs.complete(queued.jobId, {});
          const stored = await prisma.shotFulfillment.findFirstOrThrow({ where: { projectId, role } });
          expect(stored.shotRole).toBe("dialogue-closeup");
          await writeOutline("");
          await prisma.mediaAsset.update({
            where: { id: photo.id },
            data: { analysisStatus: "COMPLETED" },
          });
          await prisma.mediaAnalysis.create({
            data: {
              assetId: photo.id,
              providerKey: "test.analysis",
              schemaVersion: "1.0",
              status: "COMPLETED",
              payload: EMPTY_ROOM as Prisma.InputJsonValue,
            },
          });
          const second = build();
          const again = await second.assets.requestGenerate(ownerId, projectId, {
            roles: [
              {
                role,
                storySceneId: "scene-arrive",
                kind: "ENHANCEMENT",
                sourceMediaAssetId: photo.id,
              },
            ],
          });
          await second.assets.processJob((await jobs.get(again.jobId))!);
          await jobs.complete(again.jobId, {});
          expect(events).toEqual([]);
          await expectNoPaidAttempt(again.jobId);
          const slot = await prisma.shotFulfillment.findFirstOrThrow({ where: { projectId, role } });
          expect(slot.shotRole).toBe("dialogue-closeup");
          expect(slot.treatment).toBe("DEFER");
          expect(slot.userMessageKey).toBe("SG_WAITING");
          await finishQuietly(queued.jobId);
        } finally {
          await prisma.storyStructure.update({
            where: { id: story.id },
            data: { payload: original as Prisma.InputJsonValue },
          });
          await clearBudgetLedgers();
        }
      },
    );
    await rm(registry.dir, { recursive: true, force: true });
  });

  async function seedReadyStory(document: StoryDocument) {
    return prisma.storyStructure.create({
      data: {
        projectId,
        version: 1,
        status: StoryStructureStatus.READY,
        payload: document as Prisma.InputJsonValue,
        inputFingerprint: "seeded-story-fingerprint-not-an-asset-input",
        creativePlanId: "plan_seed",
        creativePlanVersion: 1,
        providerKey: "test.story",
        capability: "STORY_COMPOSITION",
      },
    });
  }

  async function seedReadyTimeline(
    document: TimelineDocument,
    story: { id: string; version: number },
  ) {
    return prisma.timeline.create({
      data: {
        projectId,
        version: 1,
        status: TimelineStatus.READY,
        payload: document as Prisma.InputJsonValue,
        inputFingerprint: "seeded-timeline-fingerprint-not-an-asset-input",
        storyStructureId: story.id,
        storyStructureVersion: story.version,
        providerKey: "test.timeline",
        capability: "TIMELINE_COMPOSITION",
        clips: {
          create: document.clips.map((clip, index) => ({
            sourceKind: clip.sourceKind ?? "MEDIA_ASSET",
            assetId: clip.assetId ?? null,
            generatedAssetId: clip.generatedAssetId ?? null,
            sortOrder: index,
            startMs: clip.timelineStartMs,
            endMs: clip.timelineEndMs,
          })),
        },
      },
    });
  }
});
