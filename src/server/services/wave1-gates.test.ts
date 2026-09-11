import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDeterministicStoryComposer } from "@/server/adapters/story/local-deterministic";
import { LocalDeterministicTimelineComposer } from "@/server/adapters/timeline/local-deterministic";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { CREATIVE_PLAN_SCHEMA_VERSION, type CreativePlan } from "@/server/director/schema";
import { prisma } from "@/server/db";
import { CreativePlanStatus, JobType } from "@/server/domain/status";
import { AttributionService } from "@/server/services/attribution";
import { ConsentService } from "@/server/services/consent";
import { EntitlementService } from "@/server/services/entitlement";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { StoryContractService } from "@/server/services/story-contract";
import { StoryService } from "@/server/services/story";
import { AnalysisService } from "@/server/services/analysis";
import { TasteService } from "@/server/services/taste";
import { TimelineContractService } from "@/server/services/timeline-contract";
import { TimelineService } from "@/server/services/timeline";
import { WipeService } from "@/server/services/wipe";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("W1.3 YF-B01 paid enqueue + W1.6 consent + W1.7 wipe", () => {
  const verifiedId = `w1-verified-${Date.now()}`;
  const unverifiedId = `w1-unverified-${Date.now()}`;
  let unverifiedProjectId = "";
  const projects = new ProjectService();
  const taste = new TasteService();
  const intent = new IntentService(projects, taste);
  const attribution = new AttributionService(projects);
  const entitlements = new EntitlementService();
  const consents = new ConsentService();
  let projectId = "";
  let dir = "";
  let media: MediaService;
  let jobs: PostgresJobQueue;
  let story: StoryService;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-w1-"));
    await prisma.user.createMany({
      data: [
        {
          id: verifiedId,
          name: "Verified",
          email: `${verifiedId}@example.com`,
          emailVerified: true,
        },
        {
          id: unverifiedId,
          name: "Unverified",
          email: `${unverifiedId}@example.com`,
          emailVerified: false,
        },
      ],
    });
    const project = await projects.create(verifiedId, {
      title: "Wave 1 gates",
      logline: "YF-B01.",
    });
    projectId = project.id;
    const unverifiedProject = await projects.create(unverifiedId, {
      title: "Unverified project",
      logline: "YF-B01 deny.",
    });
    unverifiedProjectId = unverifiedProject.id;
    await prisma.creativePlan.create({
      data: {
        projectId: unverifiedProjectId,
        version: 1,
        status: CreativePlanStatus.READY,
        plan: {
          schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
          concept: "Should not enqueue",
          tone: "warm",
          narrativeApproach: "observational",
          decisions: [{ kind: "tone", summary: "warm" }],
        } satisfies CreativePlan,
        inputFingerprint: "w1-unverified-plan",
        providerKey: "test.director",
        capability: "STORY_REASONING",
      },
    });
    media = new MediaService(new LocalStorageAdapter(dir), projects);
    jobs = new PostgresJobQueue();
    const contract = new StoryContractService(projects, taste, intent, media);
    const composer = new LocalDeterministicStoryComposer();
    story = new StoryService(
      jobs,
      contract,
      projects,
      attribution,
      () => ({ adapter: composer, attribution: composer.executionAttribution() }),
      () => ({ productionAvailable: true, localDevAvailable: false, canCompose: true }),
      entitlements,
    );
    await media.ingest(verifiedId, projectId, {
      filename: "still.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    await intent.upsert(verifiedId, projectId, {
      purpose: "A quiet family afternoon",
      mood: "warm",
      desiredDurationMs: 90_000,
    });
    await prisma.creativePlan.create({
      data: {
        projectId,
        version: 1,
        status: CreativePlanStatus.READY,
        plan: {
          schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
          concept: "A quiet family afternoon",
          tone: "warm",
          narrativeApproach: "observational",
          decisions: [{ kind: "tone", summary: "warm" }],
        } satisfies CreativePlan,
        inputFingerprint: "w1-plan",
        providerKey: "test.director",
        capability: "STORY_REASONING",
      },
    });
  });

  afterAll(async () => {
    await prisma.aiProcessingConsent.deleteMany({
      where: { userId: { in: [verifiedId, unverifiedId] } },
    });
    await prisma.storyStructure.deleteMany({
      where: { projectId: { in: [projectId, unverifiedProjectId] } },
    });
    await prisma.creativePlan.deleteMany({
      where: { projectId: { in: [projectId, unverifiedProjectId] } },
    });
    await prisma.providerAttribution.deleteMany({
      where: { projectId: { in: [projectId, unverifiedProjectId] } },
    });
    await prisma.job.deleteMany({
      where: { projectId: { in: [projectId, unverifiedProjectId] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [projectId, unverifiedProjectId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [verifiedId, unverifiedId] } } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("denies AI_STORY enqueue when emailVerified is false (YF-B01)", async () => {
    await expect(story.requestCompose(unverifiedId, unverifiedProjectId)).rejects.toMatchObject({
      code: "EMAIL_UNVERIFIED",
    });
    const queued = await prisma.job.count({
      where: { projectId: unverifiedProjectId, type: JobType.AI_STORY },
    });
    expect(queued).toBe(0);
  });

  it("does not consume the movie-generation hour quota for a paid-path email check", async () => {
    await entitlements.requirePaidEnqueue(verifiedId);
    const movie = await entitlements.authorizeGeneration(verifiedId, { projectId });
    expect(movie.allowed).toBe(true);
  });

  it("denies local MEDIA_ANALYZE when emailVerified is false", async () => {
    const asset = await media.ingest(unverifiedId, unverifiedProjectId, {
      filename: "local.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const analysis = new AnalysisService(
      media,
      jobs,
      {
        async analyze() {
          throw new Error("should not run");
        },
      } as never,
      projects,
      attribution,
      entitlements,
      () => false,
    );
    await expect(
      analysis.requestAnalysis(unverifiedId, unverifiedProjectId, asset.id),
    ).rejects.toMatchObject({ code: "EMAIL_UNVERIFIED" });
    expect(
      await prisma.job.count({
        where: { projectId: unverifiedProjectId, type: JobType.MEDIA_ANALYZE },
      }),
    ).toBe(0);
  });

  it("blocks production AI_STORY without AiProcessingConsent", async () => {
    await expect(story.requestCompose(verifiedId, projectId)).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    expect(
      await prisma.job.count({ where: { projectId, type: JobType.AI_STORY } }),
    ).toBe(0);
  });

  it("blocks production AI_TIMELINE without AiProcessingConsent", async () => {
    const composer = new LocalDeterministicTimelineComposer();
    const timeline = new TimelineService(
      jobs,
      new TimelineContractService(
        projects,
        taste,
        intent,
        media,
        new AnalysisService(
          media,
          jobs,
          { async analyze() { throw new Error("unused"); } } as never,
          projects,
          attribution,
          entitlements,
          () => false,
        ),
      ),
      projects,
      attribution,
      () => ({ adapter: composer, attribution: composer.executionAttribution() }),
      () => ({ productionAvailable: true, localDevAvailable: false, canCompose: true }),
      entitlements,
    );
    await expect(timeline.requestCompose(verifiedId, projectId)).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    expect(
      await prisma.job.count({ where: { projectId, type: JobType.AI_TIMELINE } }),
    ).toBe(0);
  });

  it("blocks HTTP-vision analyze without AiProcessingConsent", async () => {
    const asset = await media.ingest(verifiedId, projectId, {
      filename: "consent.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const analysis = new AnalysisService(
      media,
      jobs,
      {
        async analyze() {
          throw new Error("should not run");
        },
      } as never,
      projects,
      attribution,
      entitlements,
      () => true,
    );
    await expect(analysis.requestAnalysis(verifiedId, projectId, asset.id)).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    await consents.accept(verifiedId);
    await expect(analysis.requestAnalysis(verifiedId, projectId, asset.id)).resolves.toMatchObject({
      jobId: expect.any(String),
    });
  });

  it("wipes a project and GCs StoragePort keys", async () => {
    const wipe = new WipeService(new LocalStorageAdapter(dir), projects);
    const extra = await projects.create(verifiedId, {
      title: "Wipe me",
      logline: "M8.8-lite.",
    });
    await media.ingest(verifiedId, extra.id, {
      filename: "wipe.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const asset = await prisma.mediaAsset.findFirstOrThrow({ where: { projectId: extra.id } });
    const result = await wipe.deleteProject(verifiedId, extra.id);
    expect(result.deletedProjectIds).toEqual([extra.id]);
    expect(result.storageKeysAttempted).toBeGreaterThan(0);
    expect(await prisma.project.findUnique({ where: { id: extra.id } })).toBeNull();
    expect(await new LocalStorageAdapter(dir).exists(asset.storageKey)).toBe(false);
  });
});

describe("ConsentService W1.6", () => {
  const userId = `w1-consent-${Date.now()}`;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, name: "Consent", email: `${userId}@example.com`, emailVerified: true },
    });
  });

  afterAll(async () => {
    await prisma.aiProcessingConsent.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("records an open policyVersion string and is not CreativePlan JSON", async () => {
    const consents = new ConsentService("beta-ai-v1");
    await expect(consents.requireAccepted(userId)).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    const accepted = await consents.accept(userId);
    expect(accepted.policyVersion).toBe("beta-ai-v1");
    expect(accepted).not.toHaveProperty("plot");
    expect(await consents.hasAccepted(userId)).toBe(true);
  });
});
