import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { LocalDeterministicStoryComposer } from "@/server/adapters/story/local-deterministic";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import type { CreativePlan } from "@/server/director/schema";
import { prisma } from "@/server/db";
import {
  CreativePlanStatus,
  JobStatus,
  JobType,
  STORY_STRUCTURE_STATUSES,
  StoryStructureStatus,
} from "@/server/domain/status";
import type { StoryExecutionAttribution } from "@/server/adapters/story/attribution";
import { StoryCapability } from "@/server/ports/capabilities";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { StoryComposerInput } from "@/server/story/input";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@/server/story/schema";
import { AttributionService } from "@/server/services/attribution";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { StoryContractService } from "@/server/services/story-contract";
import { StoryService } from "@/server/services/story";
import { StoryWorker } from "@/server/services/story-worker";
import { TasteService } from "@/server/services/taste";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function samplePlan(concept = "A quiet family afternoon"): CreativePlan {
  return {
    schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
    concept,
    tone: "warm",
    narrativeApproach: "observational",
    decisions: [{ kind: "tone", summary: "warm" }],
  };
}

function scriptedComposer(
  compose: (input: StoryComposerInput) => Promise<StoryDocument> | StoryDocument,
): StoryComposerPort {
  return {
    async composeStory(input) {
      return compose(input);
    },
  };
}

const defaultAttribution = (
  overrides: Partial<StoryExecutionAttribution> = {},
): StoryExecutionAttribution => ({
  providerKey: "test.story",
  capability: StoryCapability.STORY_COMPOSITION,
  modelId: "script-1",
  modelVersion: "1",
  ...overrides,
});

describe("StoryService M1", () => {
  const ownerId = `story-owner-${Date.now()}`;
  const strangerId = `story-stranger-${Date.now()}`;
  let projectId = "";
  let dir = "";
  let media: MediaService;
  let jobs: PostgresJobQueue;
  let contract: StoryContractService;
  const projects = new ProjectService();
  const taste = new TasteService();
  const intent = new IntentService(projects, taste);
  const attribution = new AttributionService(projects);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-story-"));
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
      title: "Story composition",
      logline: "M1.",
    });
    projectId = project.id;
    media = new MediaService(new LocalStorageAdapter(dir), projects);
    jobs = new PostgresJobQueue();
    contract = new StoryContractService(projects, taste, intent, media);
    await media.ingest(ownerId, projectId, {
      filename: "still.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    await intent.upsert(ownerId, projectId, {
      purpose: "A quiet family afternoon",
      mood: "warm",
      desiredDurationMs: 90_000,
    });
    await seedReadyPlan(samplePlan());
  });

  afterAll(async () => {
    await prisma.storyStructure.deleteMany({ where: { projectId } });
    await prisma.creativePlan.deleteMany({ where: { projectId } });
    await prisma.providerAttribution.deleteMany({ where: { projectId } });
    await prisma.job.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function harness(options: {
    adapter: StoryComposerPort | null;
    attribution?: StoryExecutionAttribution;
    productionAvailable?: boolean;
    localDevAvailable?: boolean;
  }) {
    const productionAvailable = options.productionAvailable ?? Boolean(options.adapter);
    const localDevAvailable = options.localDevAvailable ?? false;
    const executionAttribution =
      options.attribution ??
      (options.adapter instanceof LocalDeterministicStoryComposer
        ? options.adapter.executionAttribution()
        : defaultAttribution());
    const story = new StoryService(
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
    return { story, worker: new StoryWorker(jobs, story) };
  }

  it("does not use STORY_COMPOSE and does not overload AiDirectorPort", () => {
    expect(JobType.AI_STORY).toBe("AI_STORY");
    expect("STORY_COMPOSE" in JobType).toBe(false);
    const port: AiDirectorPort = {
      composePlan: async () => ({ schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION }),
    };
    expect(typeof port.composePlan).toBe("function");
    expect(port).not.toHaveProperty("composeStory");
  });

  it("HTTP request only enqueues AI_STORY; worker performs composition", async () => {
    const local = new LocalDeterministicStoryComposer();
    const { story, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });

    const queued = await story.requestCompose(ownerId, projectId);
    expect(queued.status).toBe(JobStatus.PENDING);
    const job = await jobs.get(queued.jobId);
    expect(job?.type).toBe(JobType.AI_STORY);
    expect(job?.status).toBe(JobStatus.PENDING);

    const versionBefore = (await story.getLatestReady(ownerId, projectId))?.version ?? 0;
    await worker.processNext();
    const after = await story.getLatestReady(ownerId, projectId);
    expect(after).not.toBeNull();
    expect(after!.version).toBeGreaterThan(versionBefore);
    expect(after!.jobId).toBe(queued.jobId);
    expect(after!.status).toBe(StoryStructureStatus.READY);
    expect(after!.document.schemaVersion).toBe(STORY_DOCUMENT_SCHEMA_VERSION);
    expect(after!.providerKey).toBe("youflicks.local.story");
    expect(after!.capability).toBe(StoryCapability.STORY_COMPOSITION);
    expect(after!.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const status = await story.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.SUCCEEDED);
    expect(status.storyStructureId).toBe(after!.id);
  });

  it("requires a READY CreativePlan before enqueue", async () => {
    const isolated = await projects.create(ownerId, { title: "No plan yet" });
    const local = new LocalDeterministicStoryComposer();
    const { story } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(story.requestCompose(ownerId, isolated.id)).rejects.toMatchObject({
      code: "STORY_PLAN_REQUIRED",
    });
    await prisma.project.delete({ where: { id: isolated.id } });
  });

  it("increments version, preserves prior rows, and never mutates historical plan relationship", async () => {
    const local = new LocalDeterministicStoryComposer();
    const { story, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });

    await story.requestCompose(ownerId, projectId);
    await worker.processNext();
    const v1 = await story.getLatestReady(ownerId, projectId);
    expect(v1).not.toBeNull();
    const v1PlanId = v1!.creativePlanId;
    const v1PlanVersion = v1!.creativePlanVersion;

    const nextPlan = await seedReadyPlan(samplePlan("A later direction"), v1PlanId);

    await story.requestCompose(ownerId, projectId);
    await worker.processNext();
    const latest = await story.getLatestReady(ownerId, projectId);
    const all = await story.listStories(ownerId, projectId);

    expect(latest!.version).toBeGreaterThan(v1!.version);
    expect(all.some((row) => row.id === v1!.id)).toBe(true);
    const prior = all.find((row) => row.id === v1!.id);
    expect(prior?.status).toBe(StoryStructureStatus.SUPERSEDED);
    expect(prior?.creativePlanId).toBe(v1PlanId);
    expect(prior?.creativePlanVersion).toBe(v1PlanVersion);
    expect(latest!.creativePlanId).toBe(nextPlan.id);
    expect(latest!.creativePlanVersion).toBe(nextPlan.version);
    expect(latest!.creativePlanId).not.toBe(v1PlanId);
  });

  it("recomposition uses the prior READY StoryDocument for continuity", async () => {
    let seenPrior: unknown = null;
    const adapter = scriptedComposer(async (input) => {
      seenPrior = input.priorStory;
      const local = new LocalDeterministicStoryComposer();
      return local.composeStory(input);
    });
    const { story, worker } = harness({
      adapter,
      productionAvailable: true,
      localDevAvailable: false,
    });

    await story.requestCompose(ownerId, projectId);
    await worker.processNext();
    const ready = await story.getLatestReady(ownerId, projectId);
    expect(ready?.document.acts.length).toBeGreaterThan(0);

    await story.requestCompose(ownerId, projectId);
    await worker.processNext();
    expect(seenPrior).toBeTruthy();
    expect((seenPrior as StoryDocument).spine.opening).toBe(ready!.document.spine.opening);
    expect((seenPrior as StoryDocument).title).toBe(ready!.document.title);
  });

  it("records jobId, fingerprints, plan provenance, and attribution outside the port", async () => {
    const local = new LocalDeterministicStoryComposer();
    const { story, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await story.requestCompose(ownerId, projectId);
    await worker.processNext();
    const row = await story.getLatestReady(ownerId, projectId);
    expect(row!.jobId).toBe(queued.jobId);
    expect(row!.inputFingerprint).toHaveLength(64);
    expect(row!.creativePlanId).toBeTruthy();
    expect(row!.creativePlanVersion).toBeGreaterThan(0);
    expect(row!.planFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const attrs = await attribution.listForProject(ownerId, projectId);
    expect(
      attrs.some(
        (item) =>
          item.jobId === queued.jobId &&
          item.providerKey === "youflicks.local.story" &&
          item.capability === StoryCapability.STORY_COMPOSITION,
      ),
    ).toBe(true);
  });

  it("missing production story capability produces a typed configuration error", async () => {
    const { story } = harness({
      adapter: null,
      productionAvailable: false,
      localDevAvailable: false,
    });
    await expect(story.requestCompose(ownerId, projectId)).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("local deterministic adapter does not advertise production availability", async () => {
    const local = new LocalDeterministicStoryComposer();
    const { story } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const avail = story.getAvailability();
    expect(avail.productionAvailable).toBe(false);
    expect(avail.localDevAvailable).toBe(true);
    expect(avail.canCompose).toBe(true);
    expect(local.production).toBe(false);
  });

  it("rejects timing/clip-list adapter output and does not persist READY", async () => {
    const before = await storyCount();
    const adapter = scriptedComposer(async () => ({
      schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
      spine: { opening: "a", development: "b", resolution: "c" },
      acts: [
        {
          id: "act-1",
          order: 0,
          purpose: "x",
          scenes: [
            {
              id: "scene-1",
              order: 0,
              purpose: "x",
              dramaticFunction: "exposition",
              mediaRoles: [],
              startMs: 0,
              endMs: 1200,
            },
          ],
        },
      ],
      source: { creativePlanId: "x", creativePlanVersion: 1 },
    }) as never);
    const { story, worker } = harness({
      adapter,
      attribution: defaultAttribution({ providerKey: "bad.story" }),
      productionAvailable: true,
    });
    const queued = await story.requestCompose(ownerId, projectId);
    await worker.processNext();
    const status = await story.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.FAILED);
    expect(await storyCount()).toBe(before);
  });

  it("enforces ownership on compose, job status, and story reads", async () => {
    const local = new LocalDeterministicStoryComposer();
    const { story, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(story.requestCompose(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const queued = await story.requestCompose(ownerId, projectId);
    await worker.processNext();
    await expect(story.getJobStatus(strangerId, projectId, queued.jobId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(story.getLatestReady(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(story.listStories(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("minimizes input privacy and does not persist raw input or Timeline artifacts", async () => {
    const local = new LocalDeterministicStoryComposer();
    const { story, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const readyPlan = await prisma.creativePlan.findFirst({
      where: { projectId, status: CreativePlanStatus.READY },
    });
    const input = await contract.assembleInput(
      ownerId,
      projectId,
      {
        id: readyPlan!.id,
        version: readyPlan!.version,
        plan: readyPlan!.plan as CreativePlan,
        planFingerprint: "test",
      },
    );
    const blob = JSON.stringify(input);
    expect(blob).not.toMatch(/apiKey|authorization|sponsor|email|storageKey/i);
    expect(input).not.toHaveProperty("userId");
    expect(input).not.toHaveProperty("timeline");
    expect(input.creativePlan.schemaVersion).toBe(CREATIVE_PLAN_SCHEMA_VERSION);

    const queued = await story.requestCompose(ownerId, projectId);
    await worker.processNext();
    const storedJob = await jobs.get(queued.jobId);
    expect(storedJob?.payload).toEqual({
      projectId,
      requestedBy: ownerId,
    });
    expect(JSON.stringify(storedJob)).not.toContain('"creativePlan"');
    expect(JSON.stringify(storedJob)).not.toContain('"mediaInventory"');
  });

  it("writes no Timeline, RenderJob, FinishedMovie, or Publication rows and does not expand CreativePlan", async () => {
    const local = new LocalDeterministicStoryComposer();
    const { story, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const plansBefore = await prisma.creativePlan.count({ where: { projectId } });
    const timelinesBefore = await prisma.timeline.count({ where: { projectId } });
    const clipsBefore = await prisma.timelineClip.count();
    const rendersBefore = await prisma.renderJob.count({ where: { projectId } });
    const moviesBefore = await prisma.finishedMovie.count({ where: { projectId } });
    const publicationsBefore = await prisma.publication.count();

    await story.requestCompose(ownerId, projectId);
    await worker.processNext();
    const row = await story.getLatestReady(ownerId, projectId);
    const json = JSON.stringify(row!.document);
    expect(json).not.toMatch(/startMs|endMs|timelineClip|ffmpeg|renderSpec/i);
    expect(row!.document.acts[0]).toHaveProperty("purpose");
    expect(row!.status).toBe(StoryStructureStatus.READY);

    expect(await prisma.creativePlan.count({ where: { projectId } })).toBe(plansBefore);
    expect(await prisma.timeline.count({ where: { projectId } })).toBe(timelinesBefore);
    expect(await prisma.timelineClip.count()).toBe(clipsBefore);
    expect(await prisma.renderJob.count({ where: { projectId } })).toBe(rendersBefore);
    expect(await prisma.finishedMovie.count({ where: { projectId } })).toBe(moviesBefore);
    expect(await prisma.publication.count()).toBe(publicationsBefore);
  });

  it("keeps StoryStructure status on the locked enum; in-progress lives on Job only", async () => {
    const rows = await prisma.storyStructure.findMany({ where: { projectId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(STORY_STRUCTURE_STATUSES).toContain(row.status);
      expect(["PENDING", "RUNNING", "QUEUED", "PROCESSING"]).not.toContain(row.status);
    }
    const storyJobs = await prisma.job.findMany({
      where: { projectId, type: JobType.AI_STORY },
    });
    expect(storyJobs.some((job) => job.status === JobStatus.SUCCEEDED)).toBe(true);
    expect(storyJobs.some((job) => job.status === JobStatus.PENDING || job.status === JobStatus.RUNNING || job.status === JobStatus.SUCCEEDED || job.status === JobStatus.FAILED)).toBe(true);
  });

  async function storyCount() {
    return prisma.storyStructure.count({ where: { projectId } });
  }

  async function seedReadyPlan(plan: CreativePlan, supersedeId?: string) {
    if (supersedeId) {
      await prisma.creativePlan.updateMany({
        where: { projectId, status: CreativePlanStatus.READY },
        data: { status: CreativePlanStatus.SUPERSEDED },
      });
    }
    const latest = await prisma.creativePlan.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return prisma.creativePlan.create({
      data: {
        projectId,
        version: (latest?.version ?? 0) + 1,
        status: CreativePlanStatus.READY,
        plan: plan as Prisma.InputJsonValue,
        inputFingerprint: "seeded-plan-fingerprint-not-a-story-input",
        providerKey: "test.director",
        capability: "STORY_REASONING",
      },
    });
  }
});
