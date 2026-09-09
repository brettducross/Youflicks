import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { LocalDeterministicDirector } from "@/server/adapters/director/local-deterministic";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { ProviderRegistry } from "@/server/analysis/registry";
import { PreferredThenFirstPolicy } from "@/server/analysis/selection";
import { DirectorCapabilityGateway } from "@/server/director/capabilities";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { prisma } from "@/server/db";
import {
  CreativePlanStatus,
  JobStatus,
  JobType,
} from "@/server/domain/status";
import type { DirectorExecutionAttribution } from "@/server/adapters/director/attribution";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import { AnalysisCapability, DirectorCapability } from "@/server/ports/capabilities";
import type { MediaAnalysisAdapter } from "@/server/ports/media-analysis-adapter";
import type { DirectorInput } from "@/server/director/input";
import type { CreativePlan } from "@/server/director/schema";
import { AccountLifecycleService } from "@/server/services/account-lifecycle";
import { EntitlementService } from "@/server/services/entitlement";
import { AnalysisService } from "@/server/services/analysis";
import { AttributionService } from "@/server/services/attribution";
import { DirectorContractService } from "@/server/services/director-contract";
import { DirectorService } from "@/server/services/director";
import { DirectorWorker } from "@/server/services/director-worker";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { TasteService } from "@/server/services/taste";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function analysisAdapter(): MediaAnalysisAdapter {
  return {
    providerKey: "test.vision",
    capabilities: [AnalysisCapability.IMAGE_ANALYSIS],
    configured: true,
    enabled: true,
    health: () => ({
      providerKey: "test.vision",
      configured: true,
      enabled: true,
      available: true,
      capabilities: [AnalysisCapability.IMAGE_ANALYSIS],
    }),
    analyze: async () => ({
      providerKey: "test.vision",
      observations: { technical: { mimeType: "image/png" } },
    }),
  };
}

function scriptedDirector(
  compose: (input: DirectorInput) => Promise<CreativePlan> | CreativePlan,
): AiDirectorPort {
  return {
    async composePlan(input) {
      return compose(input);
    },
  };
}

const defaultAttribution = (
  overrides: Partial<DirectorExecutionAttribution> = {},
): DirectorExecutionAttribution => ({
  providerKey: "test.director",
  capability: DirectorCapability.STORY_REASONING,
  modelId: "script-1",
  modelVersion: "1",
  ...overrides,
});

describe("DirectorService Phase 2F", () => {
  const ownerId = `direct-owner-${Date.now()}`;
  const strangerId = `direct-stranger-${Date.now()}`;
  let projectId = "";
  let dir = "";
  let media: MediaService;
  let jobs: PostgresJobQueue;
  let contract: DirectorContractService;
  const projects = new ProjectService();
  const taste = new TasteService();
  const intent = new IntentService(projects, taste);
  const attribution = new AttributionService(projects);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-direct-"));
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
      title: "Director execution",
      logline: "Phase 2F.",
    });
    projectId = project.id;
    media = new MediaService(new LocalStorageAdapter(dir), projects);
    jobs = new PostgresJobQueue();
    const registry = new ProviderRegistry().register(analysisAdapter());
    const analysis = new AnalysisService(
      media,
      jobs,
      {
        async analyze() {
          return {
            analysis: { analysisSchemaVersion: "1.0", technical: { mimeType: "image/png" } },
            provenance: { providerKey: "test.vision", modelId: "fake", modelVersion: null },
          };
        },
      },
      projects,
      attribution,
    );
    contract = new DirectorContractService(
      projects,
      taste,
      intent,
      media,
      analysis,
      new DirectorCapabilityGateway(registry, new PreferredThenFirstPolicy()),
    );
    await media.ingest(ownerId, projectId, {
      filename: "still.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    await intent.upsert(ownerId, projectId, {
      purpose: "A quiet family afternoon",
      mood: "warm",
      desiredDurationMs: 90_000,
    });
  });

  afterAll(async () => {
    await prisma.creativePlan.deleteMany({ where: { projectId } });
    await prisma.providerAttribution.deleteMany({ where: { projectId } });
    await prisma.job.deleteMany({ where: { projectId } });
    await prisma.generationAuthorization.deleteMany({
      where: { userId: { in: [ownerId, strangerId] } },
    });
    await prisma.accountPlatformState.deleteMany({
      where: { userId: { in: [ownerId, strangerId] } },
    });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await prisma.generationAuthorization.deleteMany({
      where: { userId: { in: [ownerId, strangerId] } },
    });
  });

  function harness(options: {
    adapter: AiDirectorPort | null;
    attribution?: DirectorExecutionAttribution;
    productionAvailable?: boolean;
    localDevAvailable?: boolean;
  }) {
    const productionAvailable = options.productionAvailable ?? Boolean(options.adapter);
    const localDevAvailable = options.localDevAvailable ?? false;
    const executionAttribution =
      options.attribution ??
      (options.adapter instanceof LocalDeterministicDirector
        ? options.adapter.executionAttribution()
        : defaultAttribution());
    const director = new DirectorService(
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
      new EntitlementService(new AccountLifecycleService()),
    );
    return { director, worker: new DirectorWorker(jobs, director) };
  }

  it("validates creative plan schema and rejects invented confidence", async () => {
    const input = await contract.assembleInput(ownerId, projectId);
    expect(() =>
      contract.validatePlan(input, {
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "ok",
        confidence: 0.9,
      }),
    ).toThrow(AppError);
    expect(() =>
      contract.validatePlan(input, {
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "A meaning-level plan",
        decisions: [{ kind: "tone", summary: "warm" }],
      }),
    ).not.toThrow();
  });

  it("HTTP request only enqueues AI_DIRECT; worker performs composition", async () => {
    const local = new LocalDeterministicDirector();
    const { director, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });

    const queued = await director.requestCompose(ownerId, projectId);
    expect(queued.status).toBe(JobStatus.PENDING);
    const job = await jobs.get(queued.jobId);
    expect(job?.type).toBe(JobType.AI_DIRECT);
    expect(job?.status).toBe(JobStatus.PENDING);

    const before = await director.getLatestReady(ownerId, projectId);
    // May already have a plan from prior tests in this suite; enqueue alone must not create a new one.
    const versionBefore = before?.version ?? 0;

    await worker.processNext();
    const after = await director.getLatestReady(ownerId, projectId);
    expect(after).not.toBeNull();
    expect(after!.version).toBeGreaterThan(versionBefore);
    expect(after!.jobId).toBe(queued.jobId);
    expect(after!.status).toBe(CreativePlanStatus.READY);
    expect(after!.plan.schemaVersion).toBe(CREATIVE_PLAN_SCHEMA_VERSION);
    expect(after!.providerKey).toBe("youflicks.local.director");
    expect(after!.capability).toBe(DirectorCapability.STORY_REASONING);
    expect(after!.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const status = await director.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.SUCCEEDED);
    expect(status.creativePlanId).toBe(after!.id);
  });

  it("increments version and preserves previous CreativePlan rows", async () => {
    const local = new LocalDeterministicDirector();
    const { director, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });

    const first = await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    const v1 = await director.getLatestReady(ownerId, projectId);
    expect(v1).not.toBeNull();

    await prisma.generationAuthorization.deleteMany({ where: { userId: ownerId } });
    const second = await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    const latest = await director.getLatestReady(ownerId, projectId);
    const all = await director.listPlans(ownerId, projectId);

    expect(latest!.version).toBeGreaterThan(v1!.version);
    expect(latest!.jobId).toBe(second.jobId);
    expect(all.some((row) => row.id === v1!.id)).toBe(true);
    const prior = all.find((row) => row.id === v1!.id);
    expect(prior?.status).toBe(CreativePlanStatus.SUPERSEDED);
    expect(first.jobId).not.toBe(second.jobId);
  });

  it("recomposition uses priorDecisions from the previous READY CreativePlan", async () => {
    let seenPrior: unknown = null;
    const adapter = scriptedDirector(async (input) => {
      seenPrior = input.priorDecisions;
      return {
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Recomposed",
        decisions: [
          ...(input.priorDecisions ?? []),
          { kind: "film_concept", summary: "Recomposed concept" },
        ],
        rationale: "test recompose",
      };
    });
    const { director, worker } = harness({
      adapter,
      productionAvailable: true,
      localDevAvailable: false,
    });

    await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    const ready = await director.getLatestReady(ownerId, projectId);
    expect(ready?.plan.decisions?.length).toBeGreaterThan(0);

    await prisma.generationAuthorization.deleteMany({ where: { userId: ownerId } });
    await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    expect(Array.isArray(seenPrior)).toBe(true);
    expect((seenPrior as Array<{ summary: string }>).some((d) => d.summary)).toBe(true);
    const priorSummaries = (ready!.plan.decisions ?? []).map((d) => d.summary);
    for (const summary of priorSummaries) {
      expect((seenPrior as Array<{ summary: string }>).some((d) => d.summary === summary)).toBe(
        true,
      );
    }
  });

  it("records jobId and input fingerprint provenance and attribution", async () => {
    const local = new LocalDeterministicDirector();
    const { director, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const queued = await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    const plan = await director.getLatestReady(ownerId, projectId);
    expect(plan!.jobId).toBe(queued.jobId);
    expect(plan!.inputFingerprint).toHaveLength(64);

    const attrs = await attribution.listForProject(ownerId, projectId);
    expect(
      attrs.some(
        (item) =>
          item.jobId === queued.jobId &&
          item.providerKey === "youflicks.local.director" &&
          item.capability === DirectorCapability.STORY_REASONING,
      ),
    ).toBe(true);
  });

  it("denies AI_DIRECT enqueue when the owner email is unverified", async () => {
    await prisma.user.update({
      where: { id: ownerId },
      data: { emailVerified: false },
    });
    const local = new LocalDeterministicDirector();
    const { director } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const jobsBefore = await prisma.job.count({
      where: { projectId, type: JobType.AI_DIRECT },
    });
    await expect(director.requestCompose(ownerId, projectId)).rejects.toMatchObject({
      code: "EMAIL_UNVERIFIED",
    });
    expect(
      await prisma.job.count({ where: { projectId, type: JobType.AI_DIRECT } }),
    ).toBe(jobsBefore);
    await prisma.user.update({
      where: { id: ownerId },
      data: { emailVerified: true },
    });
  });

  it("missing production Director capability produces typed configuration error", async () => {
    const { director } = harness({
      adapter: null,
      productionAvailable: false,
      localDevAvailable: false,
    });
    await expect(director.requestCompose(ownerId, projectId)).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("local deterministic adapter does not advertise production availability", async () => {
    const local = new LocalDeterministicDirector();
    const { director } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const avail = director.getAvailability();
    expect(avail.productionAvailable).toBe(false);
    expect(avail.localDevAvailable).toBe(true);
    expect(avail.canCompose).toBe(true);
    expect(local.production).toBe(false);
  });

  it("rejects malformed adapter output and does not persist READY", async () => {
    const before = await directorPlansCount();
    const adapter = scriptedDirector(async () => ({ schemaVersion: "9.9", concept: "bad" }) as never);
    const { director, worker } = harness({
      adapter,
      attribution: defaultAttribution({ providerKey: "bad.director" }),
      productionAvailable: true,
    });
    const queued = await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    const status = await director.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.FAILED);
    expect(await directorPlansCount()).toBe(before);
  });

  it("rejects invented confidence from adapter output", async () => {
    const before = await directorPlansCount();
    const adapter = scriptedDirector(async () => ({
      schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
      concept: "confident",
      confidence: 0.99,
    }) as never);
    const { director, worker } = harness({
      adapter,
      attribution: defaultAttribution({ providerKey: "bad.director" }),
      productionAvailable: true,
    });
    const queued = await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    const status = await director.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.FAILED);
    expect(status.error).toMatch(/confidence/i);
    expect(await directorPlansCount()).toBe(before);
  });

  it("rejects constraint conflict without writing READY", async () => {
    const before = await directorPlansCount();
    const adapter = scriptedDirector(async () => ({
      schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
      concept: "ignore duration",
      constraints: ["ignore_duration"],
    }));
    const { director, worker } = harness({
      adapter,
      attribution: defaultAttribution({ providerKey: "bad.director" }),
      productionAvailable: true,
    });
    const queued = await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    const status = await director.getJobStatus(ownerId, projectId, queued.jobId);
    expect(status.status).toBe(JobStatus.FAILED);
    expect(status.error).toMatch(/duration/i);
    expect(await directorPlansCount()).toBe(before);
  });

  it("enforces ownership on compose, job status, and plan reads", async () => {
    const local = new LocalDeterministicDirector();
    const { director, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(director.requestCompose(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const queued = await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    await expect(
      director.getJobStatus(strangerId, projectId, queued.jobId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(director.getLatestReady(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(director.listPlans(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("minimizes Director input privacy and does not persist raw input", async () => {
    const local = new LocalDeterministicDirector();
    const { director, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const input = await contract.assembleInput(ownerId, projectId);
    const blob = JSON.stringify(input);
    expect(blob).not.toMatch(/apiKey|authorization|sponsor|email|storageKey/i);
    expect(input).not.toHaveProperty("userId");

    const queued = await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    const plan = await director.getLatestReady(ownerId, projectId);
    const storedJob = await jobs.get(queued.jobId);
    expect(storedJob?.payload).toEqual({
      projectId,
      requestedBy: ownerId,
    });
    const jobBlob = JSON.stringify(storedJob);
    expect(jobBlob).not.toContain('"tasteBrief"');
    expect(jobBlob).not.toContain('"mediaUnderstanding"');
    expect(plan!.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const row = await prisma.creativePlan.findUnique({ where: { id: plan!.id } });
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('"tasteBrief"');
    expect(JSON.stringify(row)).not.toContain('"mediaInventory"');
  });

  it("persists meaning-level CreativePlan only and writes no Story/Timeline/Render rows", async () => {
    const local = new LocalDeterministicDirector();
    const { director, worker } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const storiesBefore = await prisma.storyStructure.count({ where: { projectId } });
    const timelinesBefore = await prisma.timeline.count({ where: { projectId } });
    const rendersBefore = await prisma.renderJob.count({ where: { projectId } });

    await director.requestCompose(ownerId, projectId);
    await worker.processNext();
    const plan = await director.getLatestReady(ownerId, projectId);
    const json = JSON.stringify(plan!.plan);
    expect(json).not.toMatch(/timelineClip|startMs|endMs|renderSpec|ffmpeg/i);
    expect(plan!.plan.schemaVersion).toBe("1.0");

    expect(await prisma.storyStructure.count({ where: { projectId } })).toBe(storiesBefore);
    expect(await prisma.timeline.count({ where: { projectId } })).toBe(timelinesBefore);
    expect(await prisma.renderJob.count({ where: { projectId } })).toBe(rendersBefore);
    expect(json).not.toMatch(/planKind|adsEnabled|watermarkRequired|Billing|stripe/i);
  });

  it("denies a second AI_DIRECT enqueue within the rolling hour", async () => {
    const local = new LocalDeterministicDirector();
    const { director } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    const jobsBefore = await prisma.job.count({
      where: { projectId, type: JobType.AI_DIRECT },
    });
    await director.requestCompose(ownerId, projectId);
    await expect(director.requestCompose(ownerId, projectId)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    expect(
      await prisma.job.count({ where: { projectId, type: JobType.AI_DIRECT } }),
    ).toBe(jobsBefore + 1);
  });

  it("denies AI_DIRECT enqueue when requested duration exceeds the free max", async () => {
    await intent.upsert(ownerId, projectId, { desiredDurationMs: 720_000 });
    try {
      const local = new LocalDeterministicDirector();
      const { director } = harness({
        adapter: local,
        productionAvailable: false,
        localDevAvailable: true,
      });
      const jobsBefore = await prisma.job.count({
        where: { projectId, type: JobType.AI_DIRECT },
      });
      await expect(director.requestCompose(ownerId, projectId)).rejects.toMatchObject({
        code: "DURATION_EXCEEDS_PLAN",
        status: 403,
      });
      expect(
        await prisma.job.count({ where: { projectId, type: JobType.AI_DIRECT } }),
      ).toBe(jobsBefore);
      expect(
        await prisma.generationAuthorization.count({ where: { userId: ownerId } }),
      ).toBe(0);
    } finally {
      await intent.upsert(ownerId, projectId, { desiredDurationMs: 90_000 });
    }
  });

  it("does not let a stranger enqueue or burn the owner movie-generation quota", async () => {
    const local = new LocalDeterministicDirector();
    const { director } = harness({
      adapter: local,
      productionAvailable: false,
      localDevAvailable: true,
    });
    await expect(director.requestCompose(strangerId, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      await prisma.generationAuthorization.count({ where: { userId: ownerId } }),
    ).toBe(0);
    expect(
      await prisma.generationAuthorization.count({ where: { userId: strangerId } }),
    ).toBe(0);
    await director.requestCompose(ownerId, projectId);
    expect(
      await prisma.generationAuthorization.count({ where: { userId: ownerId } }),
    ).toBe(1);
  });

  async function directorPlansCount() {
    return prisma.creativePlan.count({ where: { projectId } });
  }
});
