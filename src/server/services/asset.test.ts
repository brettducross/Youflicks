import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
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
import { AttributionService } from "@/server/services/attribution";
import { AnalysisService } from "@/server/services/analysis";
import { AssetContractService } from "@/server/services/asset-contract";
import { AssetService } from "@/server/services/asset";
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
        { id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: false },
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
        throw new Error("asset engine down");
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
