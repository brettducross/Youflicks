import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { LocalDeterministicTimelineComposer } from "@/server/adapters/timeline/local-deterministic";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { prisma } from "@/server/db";
import {
  JobStatus,
  JobType,
  StoryStructureStatus,
  TIMELINE_STATUSES,
  TimelineStatus,
} from "@/server/domain/status";
import type { TimelineExecutionAttribution } from "@/server/adapters/timeline/attribution";
import { TimelineCapability } from "@/server/ports/capabilities";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { TimelineComposerInput } from "@/server/timeline/input";
import {
  TIMELINE_DOCUMENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "@/server/timeline/schema";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@/server/story/schema";
import { AttributionService } from "@/server/services/attribution";
import { ConsentService } from "@/server/services/consent";
import { AnalysisService } from "@/server/services/analysis";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { TimelineContractService } from "@/server/services/timeline-contract";
import { TimelineService } from "@/server/services/timeline";
import { TimelineWorker } from "@/server/services/timeline-worker";
import { TasteService } from "@/server/services/taste";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function sampleStory(title = "A quiet family afternoon"): StoryDocument {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    title,
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

function scriptedComposer(
  compose: (input: TimelineComposerInput) => Promise<TimelineDocument> | TimelineDocument,
): TimelineComposerPort {
  return {
    async composeTimeline(input) {
      return compose(input);
    },
  };
}

const defaultAttribution = (
  overrides: Partial<TimelineExecutionAttribution> = {},
): TimelineExecutionAttribution => ({
  providerKey: "test.timeline",
  capability: TimelineCapability.TIMELINE_COMPOSITION,
  modelId: "script-1",
  modelVersion: "1",
  ...overrides,
});

describe("TimelineService M2", () => {
  const ownerId = `timeline-owner-${Date.now()}`;
  const strangerId = `timeline-stranger-${Date.now()}`;
  let projectId = "";
  let dir = "";
  let media: MediaService;
  let jobs: PostgresJobQueue;
  let contract: TimelineContractService;
  const projects = new ProjectService();
  const taste = new TasteService();
  const intent = new IntentService(projects, taste);
  const attribution = new AttributionService(projects);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-timeline-"));
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
      title: "Timeline composition",
      logline: "M2.",
    });
    projectId = project.id;
    await new ConsentService().accept(ownerId);
    media = new MediaService(new LocalStorageAdapter(dir), projects);
    jobs = new PostgresJobQueue();
    const analysis = new AnalysisService(media, jobs, {
      async analyze() {
        throw new Error("analysis unused in M2 tests");
      },
    } as never);
    contract = new TimelineContractService(projects, taste, intent, media, analysis);
    await media.ingest(ownerId, projectId, {
      filename: "still.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    await intent.upsert(ownerId, projectId, {
      purpose: "A quiet family afternoon",
      mood: "warm",
      desiredDurationMs: 90_000,
    });
    await seedReadyStory(sampleStory());
  });

  afterAll(async () => {
    await prisma.timelineClip.deleteMany({
      where: { timeline: { projectId } },
    });
    await prisma.timeline.deleteMany({ where: { projectId } });
    await prisma.storyStructure.deleteMany({ where: { projectId } });
    await prisma.providerAttribution.deleteMany({ where: { projectId } });
    await prisma.job.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function harness(options: {
    adapter: TimelineComposerPort | null;
    attribution?: TimelineExecutionAttribution;
    productionAvailable?: boolean;
    localDevAvailable?: boolean;
  }) {
    const productionAvailable = options.productionAvailable ?? Boolean(options.adapter);
    const localDevAvailable = options.localDevAvailable ?? false;
    const executionAttribution =
      options.attribution ??
      (options.adapter instanceof LocalDeterministicTimelineComposer
        ? options.adapter.executionAttribution()
        : defaultAttribution());
    const timeline = new TimelineService(
      jobs,
      contract,
      projects,
      attribution,
      () =>
        options.adapter
          ? { adapter: options.adapter, attribution: executionAttribution }
          : null,
      () => ({
        productionAvailable,
        localDevAvailable,
        canCompose: Boolean(options.adapter) && (productionAvailable || localDevAvailable),
      }),
    );
    return { timeline, worker: new TimelineWorker(jobs, timeline) };
  }

  it("does not use job-type aliases and does not overload AiDirectorPort or StoryComposerPort", () => {
    expect(JobType.AI_TIMELINE).toBe("AI_TIMELINE");
    expect("TIMELINE_COMPOSE" in JobType).toBe(false);
    expect("AI_CUT" in JobType).toBe(false);
    const director: AiDirectorPort = {
      composePlan: async () => ({ schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION }),
    };
    expect(director).not.toHaveProperty("composeTimeline");
    const story: StoryComposerPort = {
      composeStory: async () => sampleStory(),
    };
    expect(story).not.toHaveProperty("composeTimeline");
  });

  it("HTTP request only enqueues AI_TIMELINE; worker performs composition", async () => {
    const local = new LocalDeterministicTimelineComposer();
    const { timeline, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });

    const queued = await timeline.requestCompose(ownerId, projectId);
    expect(queued.status).toBe(JobStatus.PENDING);
    const job = await jobs.get(queued.jobId);
    expect(job?.type).toBe(JobType.AI_TIMELINE);
    expect(job?.status).toBe(JobStatus.PENDING);

    const versionBefore = (await timeline.getLatestReady(ownerId, projectId))?.version ?? 0;
    await worker.processNext();
    const after = await timeline.getLatestReady(ownerId, projectId);
    expect(after).not.toBeNull();
    expect(after!.version).toBeGreaterThan(versionBefore);
    expect(after!.jobId).toBe(queued.jobId);
    expect(after!.status).toBe(TimelineStatus.READY);
    expect(after!.document.schemaVersion).toBe(TIMELINE_DOCUMENT_SCHEMA_VERSION);
    expect(after!.providerKey).toBe("youflicks.local.timeline");
    expect(after!.capability).toBe(TimelineCapability.TIMELINE_COMPOSITION);
    expect(after!.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(after!.storyStructureId).toBeTruthy();
    expect(after!.storyStructureVersion).toBeGreaterThan(0);

    const clips = await prisma.timelineClip.findMany({ where: { timelineId: after!.id } });
    expect(clips).toHaveLength(after!.document.clips.length);
    expect(clips.every((clip) => clip.assetId && clip.endMs > clip.startMs)).toBe(true);

    const status = await timeline.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.SUCCEEDED);
    expect(status.timelineId).toBe(after!.id);
  });

  it("requires a READY StoryStructure before enqueue", async () => {
    const isolated = await projects.create(ownerId, { title: "No story yet" });
    const local = new LocalDeterministicTimelineComposer();
    const { timeline } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(timeline.requestCompose(ownerId, isolated.id)).rejects.toMatchObject({
      code: "TIMELINE_STORY_REQUIRED",
    });
    await prisma.project.delete({ where: { id: isolated.id } });
  });

  it("increments version, preserves prior rows, and never mutates historical story relationship", async () => {
    const local = new LocalDeterministicTimelineComposer();
    const { timeline, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });

    await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    const v1 = await timeline.getLatestReady(ownerId, projectId);
    expect(v1).not.toBeNull();
    const v1StoryId = v1!.storyStructureId;
    const v1StoryVersion = v1!.storyStructureVersion;

    const nextStory = await seedReadyStory(sampleStory("A later story"), v1StoryId);

    await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    const latest = await timeline.getLatestReady(ownerId, projectId);
    const all = await timeline.listTimelines(ownerId, projectId);

    expect(latest!.version).toBeGreaterThan(v1!.version);
    expect(all.some((row) => row.id === v1!.id)).toBe(true);
    const prior = all.find((row) => row.id === v1!.id);
    expect(prior?.status).toBe(TimelineStatus.SUPERSEDED);
    expect(prior?.storyStructureId).toBe(v1StoryId);
    expect(prior?.storyStructureVersion).toBe(v1StoryVersion);
    expect(latest!.storyStructureId).toBe(nextStory.id);
    expect(latest!.storyStructureVersion).toBe(nextStory.version);
    expect(latest!.storyStructureId).not.toBe(v1StoryId);
  });

  it("rebuild uses the prior READY TimelineDocument for continuity", async () => {
    let seenPrior: unknown = null;
    const adapter = scriptedComposer(async (input) => {
      seenPrior = input.priorTimeline;
      const local = new LocalDeterministicTimelineComposer();
      return local.composeTimeline(input);
    });
    const { timeline, worker } = harness({
      adapter,
      productionAvailable: true,
      localDevAvailable: false,
    });

    await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    const ready = await timeline.getLatestReady(ownerId, projectId);
    expect(ready?.document.clips.length).toBeGreaterThan(0);

    await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    expect(seenPrior).toBeTruthy();
    expect((seenPrior as TimelineDocument).clips[0]?.assetId).toBe(
      ready!.document.clips[0]?.assetId,
    );
    expect((seenPrior as TimelineDocument).title).toBe(ready!.document.title);
  });

  it("records jobId, fingerprints, story provenance, and attribution outside the port", async () => {
    const local = new LocalDeterministicTimelineComposer();
    const { timeline, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    const row = await timeline.getLatestReady(ownerId, projectId);
    expect(row!.jobId).toBe(queued.jobId);
    expect(row!.inputFingerprint).toHaveLength(64);
    expect(row!.storyStructureId).toBeTruthy();
    expect(row!.storyStructureVersion).toBeGreaterThan(0);
    expect(row!.storyFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const attrs = await attribution.listForProject(ownerId, projectId);
    expect(
      attrs.some(
        (item) =>
          item.jobId === queued.jobId &&
          item.providerKey === "youflicks.local.timeline" &&
          item.capability === TimelineCapability.TIMELINE_COMPOSITION,
      ),
    ).toBe(true);
  });

  it("missing production timeline capability produces a typed configuration error", async () => {
    const { timeline } = harness({
      adapter: null,
      productionAvailable: false,
      localDevAvailable: false,
    });
    await expect(timeline.requestCompose(ownerId, projectId)).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("local deterministic adapter does not advertise production availability", async () => {
    const local = new LocalDeterministicTimelineComposer();
    const { timeline } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const avail = timeline.getAvailability();
    expect(avail.productionAvailable).toBe(false);
    expect(avail.localDevAvailable).toBe(true);
    expect(avail.canCompose).toBe(true);
    expect(local.production).toBe(false);
  });

  it("rejects StoryDocument-shaped or GeneratedAsset adapter output and does not persist READY", async () => {
    const before = await timelineCount();
    const clipsBefore = await prisma.timelineClip.count({
      where: { timeline: { projectId } },
    });
    const adapter = scriptedComposer(async () => ({
      schemaVersion: TIMELINE_DOCUMENT_SCHEMA_VERSION,
      spine: { opening: "a", development: "b", resolution: "c" },
      acts: [],
      generatedAssetId: "gen_1",
      source: { storyStructureId: "x", storyStructureVersion: 1 },
    }) as never);
    const { timeline, worker } = harness({
      adapter,
      attribution: defaultAttribution({ providerKey: "bad.timeline" }),
      productionAvailable: true,
    });
    const queued = await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    const status = await timeline.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.FAILED);
    expect(await timelineCount()).toBe(before);
    expect(
      await prisma.timelineClip.count({ where: { timeline: { projectId } } }),
    ).toBe(clipsBefore);
  });

  it("rejects clips that are not existing MediaAsset rows", async () => {
    const before = await timelineCount();
    const adapter = scriptedComposer(async () => ({
      schemaVersion: TIMELINE_DOCUMENT_SCHEMA_VERSION,
      totalDurationMs: 1000,
      tracks: [{ trackKey: "video.primary", kind: "VIDEO" }],
      clips: [
        {
          id: "clip-fake",
          trackKey: "video.primary",
          order: 0,
          assetId: "not-a-real-asset",
          timelineStartMs: 0,
          timelineEndMs: 1000,
        },
      ],
      source: { storyStructureId: "x", storyStructureVersion: 1 },
    }) as never);
    const { timeline, worker } = harness({
      adapter,
      productionAvailable: true,
    });
    const queued = await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    const status = await timeline.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.FAILED);
    expect(await timelineCount()).toBe(before);
  });

  it("enforces ownership on compose, job status, and timeline reads", async () => {
    const local = new LocalDeterministicTimelineComposer();
    const { timeline, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(timeline.requestCompose(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const queued = await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    await expect(timeline.getJobStatus(strangerId, projectId, queued.jobId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(timeline.getLatestReady(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(timeline.listTimelines(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("minimizes input privacy and does not persist raw input", async () => {
    const local = new LocalDeterministicTimelineComposer();
    const { timeline, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const readyStory = await prisma.storyStructure.findFirst({
      where: { projectId, status: StoryStructureStatus.READY },
    });
    const input = await contract.assembleInput(ownerId, projectId, {
      id: readyStory!.id,
      version: readyStory!.version,
      document: readyStory!.payload as StoryDocument,
      storyFingerprint: "test",
      creativePlanId: readyStory!.creativePlanId,
      creativePlanVersion: readyStory!.creativePlanVersion,
    });
    const blob = JSON.stringify(input);
    expect(blob).not.toMatch(/apiKey|authorization|sponsor|email|storageKey/i);
    expect(input).not.toHaveProperty("userId");
    expect(input).not.toHaveProperty("generatedAsset");
    expect(input.story.schemaVersion).toBe(STORY_DOCUMENT_SCHEMA_VERSION);

    const queued = await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    const storedJob = await jobs.get(queued.jobId);
    expect(storedJob?.payload).toEqual({
      projectId,
      requestedBy: ownerId,
    });
    expect(JSON.stringify(storedJob)).not.toContain('"story"');
    expect(JSON.stringify(storedJob)).not.toContain('"mediaInventory"');
  });

  it("writes no RenderJob, FinishedMovie, Publication, or GeneratedAsset and does not expand StoryStructure", async () => {
    const local = new LocalDeterministicTimelineComposer();
    const { timeline, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const storiesBefore = await prisma.storyStructure.count({ where: { projectId } });
    const plansBefore = await prisma.creativePlan.count({ where: { projectId } });
    const generatedBefore = await prisma.generatedAsset.count({ where: { projectId } });
    const rendersBefore = await prisma.renderJob.count({ where: { projectId } });
    const moviesBefore = await prisma.finishedMovie.count({ where: { projectId } });
    const publicationsBefore = await prisma.publication.count();

    await timeline.requestCompose(ownerId, projectId);
    await worker.processNext();
    const row = await timeline.getLatestReady(ownerId, projectId);
    const json = JSON.stringify(row!.document);
    expect(json).not.toMatch(/ffmpeg|vlc|libvlc|renderSpec/i);
    expect(row!.document.clips[0]).toHaveProperty("timelineStartMs");
    expect(row!.status).toBe(TimelineStatus.READY);
    expect(await prisma.generatedAsset.count({ where: { projectId } })).toBe(generatedBefore);

    const storedStory = await prisma.storyStructure.findFirst({
      where: { projectId, status: StoryStructureStatus.READY },
    });
    expect(JSON.stringify(storedStory?.payload)).not.toMatch(/timelineStartMs|timelineClip/i);

    expect(await prisma.storyStructure.count({ where: { projectId } })).toBe(storiesBefore);
    expect(await prisma.creativePlan.count({ where: { projectId } })).toBe(plansBefore);
    expect(await prisma.renderJob.count({ where: { projectId } })).toBe(rendersBefore);
    expect(await prisma.finishedMovie.count({ where: { projectId } })).toBe(moviesBefore);
    expect(await prisma.publication.count()).toBe(publicationsBefore);
  });

  it("keeps Timeline status on the locked enum; in-progress lives on Job only", async () => {
    const rows = await prisma.timeline.findMany({ where: { projectId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(TIMELINE_STATUSES).toContain(row.status);
      expect(["PENDING", "RUNNING", "QUEUED", "PROCESSING"]).not.toContain(row.status);
    }
    const timelineJobs = await prisma.job.findMany({
      where: { projectId, type: JobType.AI_TIMELINE },
    });
    expect(timelineJobs.some((job) => job.status === JobStatus.SUCCEEDED)).toBe(true);
  });

  async function timelineCount() {
    return prisma.timeline.count({ where: { projectId } });
  }

  async function seedReadyStory(document: StoryDocument, supersedeId?: string) {
    if (supersedeId) {
      await prisma.storyStructure.updateMany({
        where: { projectId, status: StoryStructureStatus.READY },
        data: { status: StoryStructureStatus.SUPERSEDED },
      });
    }
    const latest = await prisma.storyStructure.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return prisma.storyStructure.create({
      data: {
        projectId,
        version: (latest?.version ?? 0) + 1,
        status: StoryStructureStatus.READY,
        payload: document as Prisma.InputJsonValue,
        inputFingerprint: "seeded-story-fingerprint-not-a-timeline-input",
        creativePlanId: "plan_seed",
        creativePlanVersion: 1,
        providerKey: "test.story",
        capability: "STORY_COMPOSITION",
      },
    });
  }
});
