import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { HttpAssetGeneratorAdapter } from "@/server/adapters/assets/http-asset";
import { LocalDeterministicRenderer } from "@/server/adapters/renderer/local-deterministic";
import { LocalDeterministicTimelineComposer } from "@/server/adapters/timeline/local-deterministic";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { WebMediaPlaybackAdapter } from "@/server/adapters/playback/web-media";
import { VlcPlaybackAdapter } from "@/server/adapters/playback/vlc";
import { prisma } from "@/server/db";
import {
  FinishedMovieStatus,
  GeneratedAssetStatus,
  JobStatus,
  JobType,
  StoryStructureStatus,
  TimelineStatus,
} from "@/server/domain/status";
import { IN_MOVIE_SURFACE } from "@/server/advertising/types";
import { AssetCapability } from "@/server/ports/capabilities";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { validateCreativePlan } from "@/server/director/validate";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@/server/story/schema";
import {
  TIMELINE_DOCUMENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "@/server/timeline/schema";
import { ReplicateVideoBackend } from "@/server/gateways/yf-asset/backends/replicate";
import { parseYfAssetGatewayConfig } from "@/server/gateways/yf-asset/config";
import {
  createRecordedReplicateFetch,
  RECORDED_WAN_VIDEO_BYTES,
} from "@/server/gateways/yf-asset/fixtures/replicate/recorded-fetch";
import { YfAssetGenerateService } from "@/server/gateways/yf-asset/generate";
import { GatewayJobStore } from "@/server/gateways/yf-asset/jobs";
import { SpendGuard } from "@/server/gateways/yf-asset/spend";
import { PlaybackSessionStore } from "@/server/playback/sessions";
import { AttributionService } from "@/server/services/attribution";
import { AnalysisService } from "@/server/services/analysis";
import { AssetContractService } from "@/server/services/asset-contract";
import { AssetService } from "@/server/services/asset";
import { AssetWorker } from "@/server/services/asset-worker";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { isMovieKeepAccepted, MovieService } from "@/server/services/movie";
import { PlaybackService } from "@/server/services/playback";
import { ProjectService } from "@/server/services/projects";
import { RenderContractService } from "@/server/services/render-contract";
import { RenderService } from "@/server/services/render";
import { RenderWorker } from "@/server/services/render-worker";
import { TimelineContractService } from "@/server/services/timeline-contract";
import { TimelineService } from "@/server/services/timeline";
import { TimelineWorker } from "@/server/services/timeline-worker";
import { TasteService } from "@/server/services/taste";
import { describeAssetAvailability } from "@/server/assets/provider-config";
import { describeRenderAvailability } from "@/server/render/provider-config";
import { GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION } from "@/server/assets/schema";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const OPEN_PROVIDER_KEY = "replicate:wan-video/wan-2.7-i2v";

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
              { role: "broll_clip", purpose: "Motion over the porch." },
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
        role: "broll_clip",
        storySceneId: "scene-arrive",
        reason: "No unused MediaAsset available for this story role.",
      },
    ],
    source: { storyStructureId: storyId, storyStructureVersion: 1 },
  };
}

describe("R1 Replicate transport → GeneratedAsset → Render → Keep → Playback", () => {
  const ownerId = `r1-replicate-owner-${Date.now()}`;
  const projects = new ProjectService();
  const taste = new TasteService();
  const intent = new IntentService(projects, taste);
  const attribution = new AttributionService(projects);
  let projectId = "";
  let mediaAssetId = "";
  let dir = "";
  let storage: LocalStorageAdapter;
  let jobs: PostgresJobQueue;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-r1-replicate-"));
    storage = new LocalStorageAdapter(dir);
    await prisma.user.create({
      data: { id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: false },
    });
    const project = await projects.create(ownerId, {
      title: "R1 replicate proof",
      logline: "External generated clip.",
    });
    projectId = project.id;
    jobs = new PostgresJobQueue();
    const media = new MediaService(storage, projects);
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
    const story = await prisma.storyStructure.create({
      data: {
        projectId,
        version: 1,
        status: StoryStructureStatus.READY,
        payload: sampleStory() as Prisma.InputJsonValue,
        inputFingerprint: "r1-replicate-story",
        creativePlanId: "plan_seed",
        creativePlanVersion: 1,
        providerKey: "test.story",
        capability: "STORY_COMPOSITION",
      },
    });
    const timelineDoc = sampleTimeline(mediaAssetId, story.id);
    await prisma.timeline.create({
      data: {
        projectId,
        version: 1,
        status: TimelineStatus.READY,
        payload: timelineDoc as Prisma.InputJsonValue,
        inputFingerprint: "r1-replicate-timeline",
        storyStructureId: story.id,
        storyStructureVersion: 1,
        providerKey: "test.timeline",
        capability: "TIMELINE_COMPOSITION",
        clips: {
          create: timelineDoc.clips.map((clip, index) => ({
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
  });

  afterAll(async () => {
    await prisma.publication.deleteMany({ where: { movie: { projectId } } });
    await prisma.finishedMovie.deleteMany({ where: { projectId } });
    await prisma.renderJob.deleteMany({ where: { projectId } });
    await prisma.timelineClip.deleteMany({ where: { timeline: { projectId } } });
    await prisma.generatedAsset.deleteMany({ where: { projectId } });
    await prisma.timeline.deleteMany({ where: { projectId } });
    await prisma.storyStructure.deleteMany({ where: { projectId } });
    await prisma.mediaAnalysis.deleteMany({ where: { asset: { projectId } } });
    await prisma.mediaAsset.deleteMany({ where: { projectId } });
    await prisma.engineCostEvent.deleteMany({ where: { usageEvent: { userId: ownerId } } });
    await prisma.usageEvent.deleteMany({ where: { userId: ownerId } });
    await prisma.providerAttribution.deleteMany({ where: { projectId } });
    await prisma.job.deleteMany({ where: { projectId } });
    await prisma.generationAuthorization.deleteMany({ where: { userId: ownerId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("persists a gateway-generated clip and exercises mechanical Render → Keep → Playback", async () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "replicate",
      REPLICATE_API_TOKEN: "r8_recorded_token",
      YF_GATEWAY_PROVIDER_KEY: OPEN_PROVIDER_KEY,
      YF_GATEWAY_POLL_MS: "1",
      YF_GATEWAY_MAX_JOBS: "2",
      YF_GATEWAY_MAX_SPEND_USD: "5",
      YF_GATEWAY_BACKEND_INPUT_JSON: JSON.stringify({
        imageBytesBase64: PNG_1X1.toString("base64"),
      }),
    });
    const recorded = createRecordedReplicateFetch();
    const generate = new YfAssetGenerateService(
      config,
      new ReplicateVideoBackend(config, recorded),
      new GatewayJobStore(),
      new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob),
      recorded,
      async () => {},
    );

    const adapter = new HttpAssetGeneratorAdapter(
      storage,
      {
        providerKey: OPEN_PROVIDER_KEY,
        baseUrl: "http://gateway.test",
        apiKey: "gw-key",
        model: "wan-video/wan-2.7-i2v",
        timeoutMs: 30_000,
        capabilities: [AssetCapability.VIDEO_GENERATION],
      },
      async (url, init) => {
        expect(String(url)).toBe("http://gateway.test/v1/generate");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gw-key");
        const body = JSON.parse(String(init?.body));
        expect(body.kind).toBe("VIDEO_CLIP");
        expect(body.model).toBe("wan-video/wan-2.7-i2v");
        const result = await generate.generate(body);
        return new Response(JSON.stringify(result.body), { status: result.status });
      },
    );

    const media = new MediaService(storage, projects);
    const analysis = new AnalysisService(media, jobs, {
      async analyze() {
        throw new Error("analysis unused in R1 replicate proof");
      },
    } as never);
    const contract = new AssetContractService(projects, taste, intent);
    const assets = new AssetService(
      jobs,
      storage,
      contract,
      projects,
      attribution,
      () => ({
        adapter,
        attributionFor: (capability) => adapter.executionAttribution(capability),
        supportedCapabilities: adapter.supportedCapabilities(),
      }),
      () =>
        describeAssetAvailability({
          adapter,
          attributionFor: (capability) => adapter.executionAttribution(capability),
          productionAvailable: true,
          localDevAvailable: false,
          supportedCapabilities: adapter.supportedCapabilities(),
        }),
    );

    const queued = await assets.requestGenerate(ownerId, projectId, {
      roles: [{ role: "broll_clip", storySceneId: "scene-arrive", kind: "VIDEO_CLIP" }],
    });
    expect(queued.status).toBe(JobStatus.PENDING);
    await new AssetWorker(jobs, assets).processNext();

    const ready = await assets.getLatestFulfillments(ownerId, projectId);
    expect(ready).toHaveLength(1);
    expect(ready[0]?.status).toBe(GeneratedAssetStatus.READY);
    expect(ready[0]?.kind).toBe("VIDEO_CLIP");
    expect(ready[0]?.document.schemaVersion).toBe(GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION);
    expect(ready[0]?.document.storageKey).not.toMatch(/^https?:\/\//);
    const row = await prisma.generatedAsset.findUniqueOrThrow({ where: { id: ready[0]!.id } });
    expect(row.providerKey).toBe(OPEN_PROVIDER_KEY);
    expect(row.capability).toBe(AssetCapability.VIDEO_GENERATION);
    expect(row.modelId).toBe("wan-video/wan-2.7-i2v");
    expect(await storage.exists(row.storageKey)).toBe(true);
    const stored = await storage.get(row.storageKey);
    expect(Buffer.from(stored!.body).equals(RECORDED_WAN_VIDEO_BYTES)).toBe(true);
    expect(JSON.stringify(row.payload)).not.toMatch(/IN_MOVIE|planKey|credits|adsEnabled/i);
    expect(JSON.stringify(row.payload)).not.toContain("catbox");

    const timelineContract = new TimelineContractService(projects, taste, intent, media, analysis);
    const localTimeline = new LocalDeterministicTimelineComposer();
    const timeline = new TimelineService(
      jobs,
      timelineContract,
      projects,
      attribution,
      () => ({ adapter: localTimeline, attribution: localTimeline.executionAttribution() }),
      () => ({ productionAvailable: false, localDevAvailable: true, canCompose: true }),
    );
    await timeline.requestRebuild(ownerId, projectId);
    await new TimelineWorker(jobs, timeline).processNext();
    const rebuilt = await timeline.getLatestReady(ownerId, projectId);
    expect(rebuilt?.document.clips.some((clip) => clip.sourceKind === "GENERATED_ASSET")).toBe(
      true,
    );
    expect(JSON.stringify(rebuilt?.document)).not.toMatch(/IN_MOVIE|AdvertisingPort/i);

    const localRenderer = new LocalDeterministicRenderer(storage);
    const render = new RenderService(
      jobs,
      storage,
      new RenderContractService(projects, storage),
      projects,
      attribution,
      () => ({ adapter: localRenderer, attribution: localRenderer.executionAttribution() }),
      () =>
        describeRenderAvailability({
          adapter: localRenderer,
          attribution: localRenderer.executionAttribution(),
          productionAvailable: false,
          localDevAvailable: true,
        }),
    );
    await render.requestRender(ownerId, projectId);
    await new RenderWorker(jobs, render).processNext();
    const latest = await render.getLatestSuccessful(ownerId, projectId);
    expect(latest).toBeTruthy();
    const renderRow = await prisma.renderJob.findFirstOrThrow({ where: { id: latest!.id } });
    expect(JSON.stringify(renderRow.payload)).not.toMatch(/IN_MOVIE|planKey|adsEnabled/i);

    const movies = new MovieService(jobs, storage, projects, () => true);
    const kept = await movies.keep(ownerId, projectId, {
      renderJobId: latest!.id,
      async: false,
    });
    expect(isMovieKeepAccepted(kept)).toBe(false);
    if (isMovieKeepAccepted(kept)) {
      throw new Error("expected sync keep");
    }
    expect(kept.status).toBe(FinishedMovieStatus.READY);

    const sessions = new PlaybackSessionStore("r1-replicate-playback-secret");
    const playback = new PlaybackService(
      storage,
      projects,
      sessions,
      new WebMediaPlaybackAdapter(sessions),
      new VlcPlaybackAdapter(sessions, () => true),
      () => true,
    );
    const session = await playback.open(ownerId, projectId, { finishedMovieId: kept.id });
    expect(session.transport).toBe("APP_STREAM");
    const streamed = await playback.openStream(ownerId, projectId, session.sessionId);
    expect(streamed.mimeType).toBe("video/mp4");
    expect(streamed.stream.byteSize).toBeGreaterThan(0);
    streamed.stream.stream.destroy();

    expect("AI_ADS" in JobType).toBe(false);
    expect(IN_MOVIE_SURFACE).toBe("IN_MOVIE");
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Porch",
        planKey: "FAMILY",
      }),
    ).toThrow(/commercial entitlement/i);
  });
});
