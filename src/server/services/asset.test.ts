import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import type { AiVideoBudgetPort } from "@/server/sg/ai-video-budget";
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
      expect(slot.shadowDecision).toBeNull();
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
      YF_GATEWAY_MODEL: "open.model",
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
        model: "open.model",
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
    expect(slot.shadowDecision).toBeNull();
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
    } finally {
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
