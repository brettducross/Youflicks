import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { LocalDeterministicRenderer } from "@/server/adapters/renderer/local-deterministic";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { prisma } from "@/server/db";
import {
  GeneratedAssetStatus,
  JobStatus,
  JobType,
  RenderJobStatus,
  StoryStructureStatus,
  TimelineStatus,
} from "@/server/domain/status";
import type { RenderExecutionAttribution } from "@/server/adapters/renderer/attribution";
import { RenderCapability } from "@/server/ports/capabilities";
import type { RendererPort } from "@/server/ports/renderer";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import type { RenderComposerInput } from "@/server/render/input";
import type { RenderResultDocument } from "@/server/render/schema";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@/server/story/schema";
import {
  TIMELINE_DOCUMENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "@/server/timeline/schema";
import { AttributionService } from "@/server/services/attribution";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { RenderContractService } from "@/server/services/render-contract";
import { RenderService } from "@/server/services/render";
import { RenderWorker } from "@/server/services/render-worker";
import { emptyRenderAvailability, describeRenderAvailability } from "@/server/render/provider-config";
import { FREE_MAX_OUTPUT_DURATION_MS } from "@/server/entitlement/types";

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

function sampleTimeline(assetId: string, storyId: string, generatedId?: string): TimelineDocument {
  const clips: TimelineDocument["clips"] = [
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
  ];
  if (generatedId) {
    clips.push({
      id: "clip-2",
      trackKey: "video.primary",
      order: 1,
      sourceKind: "GENERATED_ASSET",
      generatedAssetId: generatedId,
      storySceneId: "scene-arrive",
      mediaRole: "intimate_portrait",
      timelineStartMs: 3000,
      timelineEndMs: 5000,
    });
  }
  return {
    schemaVersion: TIMELINE_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor cut",
    totalDurationMs: generatedId ? 5000 : 3000,
    tracks: [
      { trackKey: "video.primary", kind: "VIDEO" },
      { trackKey: "audio.voice", kind: "AUDIO" },
      { trackKey: "audio.music", kind: "AUDIO" },
      { trackKey: "caption.main", kind: "CAPTION" },
    ],
    clips,
    unmetMediaRoles: generatedId
      ? []
      : [
          {
            role: "intimate_portrait",
            storySceneId: "scene-arrive",
            reason: "No unused MediaAsset available for this story role.",
          },
        ],
    source: { storyStructureId: storyId, storyStructureVersion: 1 },
  };
}

function scriptedRenderer(
  render: (input: RenderComposerInput) => Promise<RenderResultDocument> | RenderResultDocument,
): RendererPort {
  return {
    async render(input) {
      return render(input);
    },
  };
}

const defaultAttribution = (
  overrides: Partial<RenderExecutionAttribution> = {},
): RenderExecutionAttribution => ({
  providerKey: "test.renderer",
  capability: RenderCapability.VIDEO_RENDER,
  modelId: "script-1",
  modelVersion: "1",
  ...overrides,
});

describe("RenderService M4", () => {
  const ownerId = `render-owner-${Date.now()}`;
  const strangerId = `render-stranger-${Date.now()}`;
  let projectId = "";
  let mediaAssetId = "";
  let dir = "";
  let storage: LocalStorageAdapter;
  let media: MediaService;
  let jobs: PostgresJobQueue;
  let contract: RenderContractService;
  const projects = new ProjectService();
  const attribution = new AttributionService(projects);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-render-"));
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
      title: "Render cut",
      logline: "M4.",
    });
    projectId = project.id;
    media = new MediaService(storage, projects);
    jobs = new PostgresJobQueue();
    contract = new RenderContractService(projects, storage);
    const ingested = await media.ingest(ownerId, projectId, {
      filename: "still.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    mediaAssetId = ingested.id;
    const story = await seedReadyStory(sampleStory());
    await seedReadyTimeline(sampleTimeline(mediaAssetId, story.id), story);
  });

  afterAll(async () => {
    await prisma.renderJob.deleteMany({ where: { projectId } });
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
    adapter: RendererPort | null;
    attribution?: RenderExecutionAttribution;
    productionAvailable?: boolean;
    localDevAvailable?: boolean;
  }) {
    const productionAvailable = options.productionAvailable ?? Boolean(options.adapter);
    const localDevAvailable = options.localDevAvailable ?? false;
    const executionAttribution = options.attribution ?? defaultAttribution();
    const render = new RenderService(
      jobs,
      storage,
      contract,
      projects,
      attribution,
      () =>
        options.adapter
          ? { adapter: options.adapter, attribution: executionAttribution }
          : null,
      () => {
        if (!options.adapter) {
          return emptyRenderAvailability();
        }
        return describeRenderAvailability({
          adapter: options.adapter,
          attribution: executionAttribution,
          productionAvailable,
          localDevAvailable,
        });
      },
    );
    return { render, worker: new RenderWorker(jobs, render) };
  }

  it("does not use job-type aliases and does not overload Director/Story/Timeline/Asset ports", () => {
    expect(JobType.RENDER).toBe("RENDER");
    expect("AI_RENDER" in JobType).toBe(false);
    expect("FFMPEG_JOB" in JobType).toBe(false);
    const director: AiDirectorPort = {
      composePlan: async () => ({ schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION }),
    };
    expect(director).not.toHaveProperty("render");
    const story: StoryComposerPort = {
      composeStory: async () => sampleStory(),
    };
    expect(story).not.toHaveProperty("render");
    const timeline: TimelineComposerPort = {
      composeTimeline: async () => sampleTimeline(mediaAssetId, "story"),
    };
    expect(timeline).not.toHaveProperty("render");
    const assets: AssetGeneratorPort = {
      generate: async () => {
        throw new Error("unused");
      },
    };
    expect(assets).not.toHaveProperty("render");
  });

  it("HTTP request only enqueues RENDER; worker persists SUCCEEDED RenderJob", async () => {
    const local = new LocalDeterministicRenderer(storage);
    const { render, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });

    const queued = await render.requestRender(ownerId, projectId);
    expect(queued.status).toBe(JobStatus.PENDING);
    const job = await jobs.get(queued.jobId);
    expect(job?.type).toBe(JobType.RENDER);
    expect(job?.status).toBe(JobStatus.PENDING);
    expect(
      await prisma.renderJob.count({
        where: { projectId, status: RenderJobStatus.SUCCEEDED },
      }),
    ).toBe(0);

    await worker.processNext();
    const latest = await render.getLatestSuccessful(ownerId, projectId);
    expect(latest).not.toBeNull();
    expect(latest?.status).toBe(RenderJobStatus.SUCCEEDED);
    expect(latest?.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(latest?.mimeType).toBe("video/mp4");
    const row = await prisma.renderJob.findFirstOrThrow({
      where: { id: latest!.id },
    });
    expect(row.outputKey).toBeTruthy();
    expect(row.outputKey).not.toMatch(/^https?:\/\//);
    expect(row.providerKey).toBe("test.renderer");
    expect(row.capability).toBe(RenderCapability.VIDEO_RENDER);
    expect(await storage.exists(row.outputKey!)).toBe(true);

    const status = await render.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.SUCCEEDED);
    expect(status.renderStatus).toBe(RenderJobStatus.SUCCEEDED);

    const usage = await prisma.usageEvent.findMany({
      where: { jobId: queued.jobId },
      include: { engineCosts: true },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      kind: "RENDER_SECONDS",
      outcome: "SUCCEEDED",
      userId: ownerId,
      projectId,
    });
    expect(usage[0]!.quantity).toBeGreaterThan(0);
    expect(usage[0]!.engineCosts[0]).toMatchObject({
      providerKey: "test.renderer",
      capability: RenderCapability.VIDEO_RENDER,
      costKind: "ESTIMATED",
    });
    expect(JSON.stringify(row.payload)).not.toMatch(/engineCost|costUnits|usageEvent/i);
  });

  it("records FAILED RENDER_SECONDS when the renderer throws", async () => {
    const { render, worker } = harness({
      adapter: scriptedRenderer(() => {
        throw AppError.jobFailed("render engine down");
      }),
      productionAvailable: true,
    });
    const queued = await render.requestRender(ownerId, projectId);
    await worker.processNext();
    const usage = await prisma.usageEvent.findMany({
      where: { jobId: queued.jobId },
      include: { engineCosts: true },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      kind: "RENDER_SECONDS",
      outcome: "FAILED",
      quantity: 0,
    });
    expect(usage[0]!.engineCosts[0]?.providerKey).toBe("test.renderer");
  });

  it("renders a READY Timeline even when unmetMediaRoles remain", async () => {
    const timeline = await prisma.timeline.findFirst({
      where: { projectId, status: TimelineStatus.READY },
    });
    const document = timeline!.payload as TimelineDocument;
    expect(document.unmetMediaRoles?.length).toBeGreaterThan(0);
    const latest = await prisma.renderJob.findFirst({
      where: { projectId, status: RenderJobStatus.SUCCEEDED },
    });
    expect(latest).not.toBeNull();
  });

  it("requires a READY Timeline before enqueue", async () => {
    const isolated = await projects.create(ownerId, { title: "No cut yet" });
    const local = new LocalDeterministicRenderer(storage);
    const { render } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(render.requestRender(ownerId, isolated.id)).rejects.toMatchObject({
      code: "RENDER_TIMELINE_REQUIRED",
    });
    await prisma.project.delete({ where: { id: isolated.id } });
  });

  it("fails typed when a clip source is not READY with storage bytes", async () => {
    const isolated = await projects.create(ownerId, { title: "Broken source" });
    const story = await prisma.storyStructure.create({
      data: {
        projectId: isolated.id,
        version: 1,
        status: StoryStructureStatus.READY,
        payload: sampleStory() as Prisma.InputJsonValue,
        inputFingerprint: "seeded-story-broken-source",
        creativePlanId: "plan_seed",
        creativePlanVersion: 1,
        providerKey: "test.story",
        capability: "STORY_COMPOSITION",
      },
    });
    const brokenAsset = await media.ingest(ownerId, isolated.id, {
      filename: "missing.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    await prisma.mediaAsset.update({
      where: { id: brokenAsset.id },
      data: { status: "FAILED" },
    });
    await prisma.timeline.create({
      data: {
        projectId: isolated.id,
        version: 1,
        status: TimelineStatus.READY,
        payload: sampleTimeline(brokenAsset.id, story.id) as Prisma.InputJsonValue,
        inputFingerprint: "seeded-timeline-broken-source",
        storyStructureId: story.id,
        storyStructureVersion: 1,
        providerKey: "test.timeline",
        capability: "TIMELINE_COMPOSITION",
        clips: {
          create: {
            sourceKind: "MEDIA_ASSET",
            assetId: brokenAsset.id,
            sortOrder: 0,
            startMs: 0,
            endMs: 3000,
            payload: { clipId: "clip-1", trackKey: "video.primary" },
          },
        },
      },
    });
    const local = new LocalDeterministicRenderer(storage);
    const { render } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(render.requestRender(ownerId, isolated.id)).rejects.toMatchObject({
      code: "RENDER_SOURCE_UNRESOLVED",
    });
    await prisma.renderJob.deleteMany({ where: { projectId: isolated.id } });
    await prisma.timelineClip.deleteMany({ where: { timeline: { projectId: isolated.id } } });
    await prisma.timeline.deleteMany({ where: { projectId: isolated.id } });
    await prisma.storyStructure.deleteMany({ where: { projectId: isolated.id } });
    await prisma.mediaAsset.deleteMany({ where: { projectId: isolated.id } });
    await prisma.project.delete({ where: { id: isolated.id } });
  });

  it("resolves MEDIA_ASSET and GENERATED_ASSET clip sources via StoragePort", async () => {
    const generatedKey = `projects/${projectId}/generated/intimate_portrait/seed/original.png`;
    await storage.put({
      key: generatedKey,
      body: new Uint8Array(PNG_1X1),
      contentType: "image/png",
    });
    const generated = await prisma.generatedAsset.create({
      data: {
        projectId,
        status: GeneratedAssetStatus.READY,
        kind: "IMAGE",
        origin: "GENERATED",
        role: "intimate_portrait",
        mimeType: "image/png",
        byteSize: BigInt(PNG_1X1.byteLength),
        storageKey: generatedKey,
        payload: {
          schemaVersion: "1.0",
          kind: "IMAGE",
          role: "intimate_portrait",
          mimeType: "image/png",
          storageKey: generatedKey,
          origin: "GENERATED",
          fulfillment: { timelineId: "tl_mixed", timelineVersion: 1 },
          source: {},
        } as Prisma.InputJsonValue,
        inputFingerprint: "seeded-generated-for-render",
        providerKey: "test.asset",
        capability: "IMAGE_GENERATION",
      },
    });
    const story = await prisma.storyStructure.findFirstOrThrow({
      where: { projectId, status: StoryStructureStatus.READY },
    });
    const mixed = sampleTimeline(mediaAssetId, story.id, generated.id);
    await prisma.timeline.updateMany({
      where: { projectId, status: TimelineStatus.READY },
      data: { status: TimelineStatus.SUPERSEDED },
    });
    await prisma.timeline.create({
      data: {
        projectId,
        version: 2,
        status: TimelineStatus.READY,
        payload: mixed as Prisma.InputJsonValue,
        inputFingerprint: "seeded-timeline-mixed-render",
        storyStructureId: story.id,
        storyStructureVersion: 1,
        providerKey: "test.timeline",
        capability: "TIMELINE_COMPOSITION",
        clips: {
          create: mixed.clips.map((clip, index) => ({
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

    const local = new LocalDeterministicRenderer(storage);
    const { render, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await render.requestRender(ownerId, projectId);
    await worker.processNext();
    const latest = await render.getLatestSuccessful(ownerId, projectId);
    expect(latest?.timelineVersion).toBe(2);
    const row = await prisma.renderJob.findFirstOrThrow({ where: { id: latest!.id } });
    const payload = row.payload as { manifest: { clips: Array<{ sourceKind: string }> } };
    const kinds = payload.manifest.clips.map((clip) => clip.sourceKind);
    expect(kinds).toContain("MEDIA_ASSET");
    expect(kinds).toContain("GENERATED_ASSET");
    expect(queued.jobId).toBeTruthy();
  });

  it("local deterministic adapter does not advertise production availability", async () => {
    const local = new LocalDeterministicRenderer(storage);
    const { render } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const avail = render.getAvailability();
    expect(avail.productionAvailable).toBe(false);
    expect(avail.localDevAvailable).toBe(true);
    expect(avail.canRender).toBe(true);
    expect(local.production).toBe(false);
  });

  it("idempotent enqueue returns the open job for the same inputFingerprint", async () => {
    const local = new LocalDeterministicRenderer(storage);
    const { render } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const first = await render.requestRender(ownerId, projectId);
    const second = await render.requestRender(ownerId, projectId);
    expect(second.jobId).toBe(first.jobId);
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
    await jobs.cancel(first.jobId);
    await prisma.renderJob.updateMany({
      where: { jobId: first.jobId, status: { in: [RenderJobStatus.QUEUED, RenderJobStatus.RUNNING] } },
      data: { status: RenderJobStatus.CANCELLED },
    });
  });

  it("cancel does not mark partial output SUCCEEDED", async () => {
    let started = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const local = new LocalDeterministicRenderer(storage);
    const adapter = scriptedRenderer(async (input) => {
      started = true;
      await gate;
      return local.render(input);
    });
    const { render, worker } = harness({
      adapter,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await render.requestRender(ownerId, projectId);
    const process = worker.processNext();
    await viWaitUntil(() => started);
    await render.cancelJob(ownerId, projectId, queued.jobId);
    release();
    await process;
    const status = await render.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.CANCELLED);
    const row = await prisma.renderJob.findFirstOrThrow({ where: { jobId: queued.jobId } });
    expect(row.status).toBe(RenderJobStatus.CANCELLED);
    expect(row.status).not.toBe(RenderJobStatus.SUCCEEDED);
  });

  it("failure and retry do not corrupt prior SUCCEEDED renders", async () => {
    const readyBefore = await prisma.renderJob.findMany({
      where: { projectId, status: RenderJobStatus.SUCCEEDED },
    });
    expect(readyBefore.length).toBeGreaterThan(0);
    const failing = scriptedRenderer(async () => {
      throw new Error("transient renderer failure");
    });
    const { render, worker } = harness({
      adapter: failing,
      productionAvailable: true,
    });
    const queued = await render.requestRender(ownerId, projectId);
    await worker.processNext();
    const status = await render.getJobStatus(ownerId, projectId, queued.jobId);
    expect(["FAILED", "PENDING"]).toContain(status.status);
    const stillReady = await prisma.renderJob.findMany({
      where: { id: { in: readyBefore.map((row) => row.id) } },
    });
    expect(stillReady.every((row) => row.status === RenderJobStatus.SUCCEEDED)).toBe(true);
  });

  it("enforces ownership on render, job status, and latest metadata", async () => {
    const local = new LocalDeterministicRenderer(storage);
    const { render } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(render.requestRender(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const queued = await render.requestRender(ownerId, projectId);
    await expect(render.getJobStatus(strangerId, projectId, queued.jobId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(render.getLatestSuccessful(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await jobs.cancel(queued.jobId);
  });

  it("writes no FinishedMovie or Publication product paths", async () => {
    const moviesBefore = await prisma.finishedMovie.count({ where: { projectId } });
    const publicationsBefore = await prisma.publication.count();
    const local = new LocalDeterministicRenderer(storage);
    const { render, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await render.requestRender(ownerId, projectId);
    await worker.processNext();
    expect(await prisma.finishedMovie.count({ where: { projectId } })).toBe(moviesBefore);
    expect(await prisma.publication.count()).toBe(publicationsBefore);
  });

  it("records attribution outside RendererPort and rejects providerKey on the return", async () => {
    const local = new LocalDeterministicRenderer(storage);
    const leaking = scriptedRenderer(async (input) => {
      const result = await local.render(input);
      return { ...result, providerKey: "should-not-be-here" } as RenderResultDocument & {
        providerKey: string;
      };
    });
    const { render, worker } = harness({
      adapter: leaking,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await render.requestRender(ownerId, projectId);
    await worker.processNext();
    const failed = await prisma.job.findFirst({
      where: { projectId, type: JobType.RENDER },
      orderBy: { createdAt: "desc" },
    });
    expect(failed?.status).not.toBe(JobStatus.SUCCEEDED);

    const honest = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await honest.render.requestRender(ownerId, projectId);
    await honest.worker.processNext();
    const recorded = await prisma.providerAttribution.findFirst({
      where: { projectId, jobId: queued.jobId },
    });
    expect(recorded?.capability).toBe(RenderCapability.VIDEO_RENDER);
    expect(recorded?.providerKey).toBe("test.renderer");
  });

  it("applies WatermarkPolicy to free local output without writing ads into the manifest", async () => {
    const local = new LocalDeterministicRenderer(storage);
    const { render, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await render.requestRender(ownerId, projectId);
    await worker.processNext();
    const latest = await render.getLatestSuccessful(ownerId, projectId);
    expect(latest).not.toBeNull();
    const row = await prisma.renderJob.findFirstOrThrow({ where: { id: latest!.id } });
    const stored = await storage.get(row.outputKey!);
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored!.body).toString("utf8")).toContain("watermark=YouFlicks");
    expect(JSON.stringify(row.payload)).not.toMatch(/adsEnabled|planKind|IN_MOVIE|AdvertisingPort/i);
  });

  it("fails typed when produced duration exceeds the free max", async () => {
    const { render, worker } = harness({
      adapter: scriptedRenderer(async (input) => {
        const local = new LocalDeterministicRenderer(storage);
        const result = await local.render(input);
        return { ...result, durationMs: FREE_MAX_OUTPUT_DURATION_MS + 1 };
      }),
      productionAvailable: true,
    });
    const queued = await render.requestRender(ownerId, projectId);
    await worker.processNext();
    const status = await render.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.FAILED);
    expect(status.error).toMatch(/5 minutes/i);
    const usage = await prisma.usageEvent.findMany({ where: { jobId: queued.jobId } });
    expect(usage[0]).toMatchObject({ kind: "RENDER_SECONDS", outcome: "FAILED" });
  });

  async function seedReadyStory(document: StoryDocument) {
    return prisma.storyStructure.create({
      data: {
        projectId,
        version: 1,
        status: StoryStructureStatus.READY,
        payload: document as Prisma.InputJsonValue,
        inputFingerprint: "seeded-story-fingerprint-not-a-render-input",
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
        inputFingerprint: "seeded-timeline-fingerprint-not-a-render-input",
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

async function viWaitUntil(predicate: () => boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for renderer to start.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
