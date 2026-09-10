import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { WebMediaPlaybackAdapter } from "@/server/adapters/playback/web-media";
import { VlcPlaybackAdapter } from "@/server/adapters/playback/vlc";
import { PublicationAdapterRegistry } from "@/server/adapters/publication/registry";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { prisma } from "@/server/db";
import {
  JobStatus,
  JobType,
  PublicationStatus,
  RenderJobStatus,
  StoryStructureStatus,
  TimelineStatus,
} from "@/server/domain/status";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { PlaybackPort } from "@/server/ports/playback";
import type { PublicationPort } from "@/server/ports/publication";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import { PlaybackSessionStore } from "@/server/playback/sessions";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { libraryStorageKey } from "@/server/movie/schema";
import { PublicationDestination } from "@/server/publication/schema";
import { ShareTokenStore } from "@/server/publication/tokens";
import { isMovieKeepAccepted, MovieService } from "@/server/services/movie";
import { PlaybackService } from "@/server/services/playback";
import { ProjectService } from "@/server/services/projects";
import { isPublicationAccepted, PublicationService } from "@/server/services/publication";
import { PublicationWorker } from "@/server/services/publication-worker";

const OUTPUT_BYTES = new Uint8Array(Buffer.from("YouFlicks M7 share export fixture\n", "utf8"));

describe("PublicationService M7", () => {
  const ownerId = `pub-owner-${Date.now()}`;
  const strangerId = `pub-stranger-${Date.now()}`;
  const projects = new ProjectService();
  const jobs = new PostgresJobQueue();
  let projectId = "";
  let timelineId = "";
  let succeededId = "";
  let readyMovieId = "";
  let archivedMovieId = "";
  let dir = "";
  let storage: LocalStorageAdapter;
  let movies: MovieService;
  let service: PublicationService;
  let worker: PublicationWorker;
  let playback: PlaybackService;
  let tokens: ShareTokenStore;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-publication-"));
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
      title: "Share cut",
      logline: "M7.",
    });
    projectId = project.id;
    const story = await prisma.storyStructure.create({
      data: {
        projectId,
        version: 1,
        status: StoryStructureStatus.READY,
        payload: { schemaVersion: "1.0", title: "Share" },
        inputFingerprint: "pub-story-fingerprint",
        creativePlanId: "plan_seed",
        creativePlanVersion: 1,
        providerKey: "test.story",
        capability: "STORY_COMPOSITION",
      },
    });
    const timeline = await prisma.timeline.create({
      data: {
        projectId,
        version: 1,
        status: TimelineStatus.READY,
        payload: { schemaVersion: "1.0", title: "Share cut" },
        inputFingerprint: "pub-timeline-fingerprint",
        storyStructureId: story.id,
        storyStructureVersion: story.version,
        providerKey: "test.timeline",
        capability: "TIMELINE_COMPOSITION",
      },
    });
    timelineId = timeline.id;

    movies = new MovieService(jobs, storage, projects, () => true);
    tokens = new ShareTokenStore("publication-share-test-secret");
    const adapters = new PublicationAdapterRegistry();
    service = new PublicationService(jobs, storage, projects, adapters, tokens, {
      publicOrigin: "http://127.0.0.1:43147",
    });
    worker = new PublicationWorker(jobs, service);
    const sessions = new PlaybackSessionStore("publication-playback-test-secret");
    const web = new WebMediaPlaybackAdapter(sessions);
    const native = new VlcPlaybackAdapter(sessions, () => true);
    playback = new PlaybackService(storage, projects, sessions, web, native, () => true, service);

    const render = await prisma.renderJob.create({
      data: {
        projectId,
        timelineId,
        timelineVersion: 1,
        inputFingerprint: `pub-ok-${Math.random()}`,
        capability: "VIDEO_RENDER",
        providerKey: "test.renderer",
        status: RenderJobStatus.SUCCEEDED,
        outputKey: `projects/${projectId}/renders/ok/output.mp4`,
        mimeType: "video/mp4",
        durationMs: 4000,
        byteSize: BigInt(OUTPUT_BYTES.byteLength),
      },
    });
    succeededId = render.id;
    await storage.put({
      key: `projects/${projectId}/renders/ok/output.mp4`,
      body: OUTPUT_BYTES,
      contentType: "video/mp4",
    });

    const kept = await movies.keep(ownerId, projectId, { renderJobId: succeededId, title: "Ready film" });
    if (isMovieKeepAccepted(kept)) {
      throw new Error("expected sync keep");
    }
    readyMovieId = kept.id;

    const archived = await movies.keep(ownerId, projectId, {
      renderJobId: succeededId,
      title: "Archived film",
    });
    if (isMovieKeepAccepted(archived)) {
      throw new Error("expected sync keep");
    }
    await movies.archive(ownerId, projectId, archived.id);
    archivedMovieId = archived.id;
  });

  afterAll(async () => {
    await prisma.publication.deleteMany({});
    await prisma.finishedMovie.deleteMany({ where: { projectId } });
    await prisma.renderJob.deleteMany({ where: { projectId } });
    await prisma.timeline.deleteMany({ where: { projectId } });
    await prisma.storyStructure.deleteMany({ where: { projectId } });
    await prisma.job.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("does not invent AI_PUBLISH / AI_SHARE and does not overload ports", () => {
    expect(JobType.PUBLISH).toBe("PUBLISH");
    expect("AI_PUBLISH" in JobType).toBe(false);
    expect("AI_SHARE" in JobType).toBe(false);
    const renderer: RendererPort = {
      render: async () => {
        throw new Error("unused");
      },
    };
    expect(renderer).not.toHaveProperty("publish");
    const playbackPort: PlaybackPort = {
      open: async () => {
        throw new Error("unused");
      },
      getStatus: async () => ({ sessionId: "", renderJobId: "", state: "OPEN" }),
      close: async () => undefined,
    };
    expect(playbackPort).not.toHaveProperty("publish");
    const director: AiDirectorPort = {
      composePlan: async () => ({ schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION }),
    };
    expect(director).not.toHaveProperty("publish");
    const story: StoryComposerPort = {
      composeStory: async () => ({ schemaVersion: "1.0" }) as never,
    };
    expect(story).not.toHaveProperty("publish");
    const timeline: TimelineComposerPort = {
      composeTimeline: async () => ({ schemaVersion: "1.0" }) as never,
    };
    expect(timeline).not.toHaveProperty("publish");
    const assets: AssetGeneratorPort = {
      generate: async () => {
        throw new Error("unused");
      },
    };
    expect(assets).not.toHaveProperty("publish");
    const publication: PublicationPort = {
      destinationKey: "DOWNLOAD",
      publish: async () => ({ status: "PUBLISHED" }),
    };
    expect(publication).toHaveProperty("publish");
    expect(publication).not.toHaveProperty("composePlan");
  });

  it("lets the owner export a READY film as an attachment Publication", async () => {
    const result = await service.exportDownload(ownerId, projectId, readyMovieId);
    expect(isPublicationAccepted(result)).toBe(false);
    if (isPublicationAccepted(result)) {
      throw new Error("expected sync export");
    }
    expect(result.publication.destinationKey).toBe(PublicationDestination.DOWNLOAD);
    expect(result.publication.status).toBe(PublicationStatus.PUBLISHED);
    expect(result.publication).not.toHaveProperty("storageKey");
    expect(result.publication.payload).not.toHaveProperty("token");
    expect(JSON.stringify(result.publication)).not.toMatch(/https?:\/\/|cdn\.|ffmpeg|vlc/i);
    expect(result.filename).toMatch(/\.mp4$/);
    expect(result.stream.byteSize).toBe(OUTPUT_BYTES.byteLength);
    result.stream.stream.destroy();

    const row = await prisma.publication.findUniqueOrThrow({ where: { id: result.publication.id } });
    expect(row.movieId).toBe(readyMovieId);
    expect(row.destinationKey).toBe("DOWNLOAD");
  });

  it("lets the owner create a time-limited share link with fingerprint only", async () => {
    const created = await service.createShareLink(ownerId, projectId, readyMovieId);
    expect(isPublicationAccepted(created)).toBe(false);
    if (isPublicationAccepted(created)) {
      throw new Error("expected sync share");
    }
    expect(created.publication.destinationKey).toBe(PublicationDestination.SHARE_LINK);
    expect(created.publication.status).toBe(PublicationStatus.PUBLISHED);
    expect(created.publication.payload?.expiresAt).toBeTruthy();
    expect(created.publication.payload?.tokenFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(created.publication.payload).not.toHaveProperty("token");
    expect(JSON.stringify(created.publication)).not.toContain(created.token);
    expect(created.shareUrl).toMatch(/^http:\/\/127\.0\.0\.1:43147\/watch\//);
    expect(created.token).toBeTruthy();
  });

  it("revokes a share link so subsequent verify and watch fail", async () => {
    const created = await service.createShareLink(ownerId, projectId, readyMovieId);
    if (isPublicationAccepted(created)) {
      throw new Error("expected sync share");
    }
    const session = await playback.openWithShareToken(created.token);
    expect(session.finishedMovieId).toBe(readyMovieId);
    expect(session.streamPath).toMatch(/^\/api\/share\/sessions\/.+\/stream$/);
    expect(session).not.toHaveProperty("storageKey");

    const streamed = await playback.openShareStream(session.sessionId);
    expect(streamed.stream.byteSize).toBe(OUTPUT_BYTES.byteLength);
    streamed.stream.stream.destroy();

    const revoked = await service.revoke(ownerId, projectId, created.publication.id);
    expect(revoked.status).toBe(PublicationStatus.REVOKED);
    expect(revoked.payload?.revokedAt).toBeTruthy();

    await expect(service.verifyShareToken(created.token)).rejects.toMatchObject({
      code: "PUBLICATION_REVOKED",
    });
    await expect(playback.openWithShareToken(created.token)).rejects.toMatchObject({
      code: "PUBLICATION_REVOKED",
    });
    await expect(playback.openShareStream(session.sessionId)).rejects.toMatchObject({
      code: "PUBLICATION_REVOKED",
    });
  });

  it("blocks a stranger from export / share / list / revoke", async () => {
    const created = await service.createShareLink(ownerId, projectId, readyMovieId);
    if (isPublicationAccepted(created)) {
      throw new Error("expected sync share");
    }
    await expect(service.exportDownload(strangerId, projectId, readyMovieId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.createShareLink(strangerId, projectId, readyMovieId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.list(strangerId, projectId, readyMovieId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.revoke(strangerId, projectId, created.publication.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects non-READY films and missing destinations", async () => {
    await expect(service.exportDownload(ownerId, projectId, archivedMovieId)).rejects.toMatchObject({
      code: "PUBLICATION_MOVIE_REQUIRED",
    });
    const empty = new PublicationAdapterRegistry([]);
    const closed = new PublicationService(jobs, storage, projects, empty, tokens);
    await expect(closed.exportDownload(ownerId, projectId, readyMovieId)).rejects.toMatchObject({
      code: "PUBLICATION_DESTINATION_UNAVAILABLE",
    });
    const noShare = new PublicationService(
      jobs,
      storage,
      projects,
      new PublicationAdapterRegistry(),
      new ShareTokenStore("short"),
    );
    await expect(noShare.createShareLink(ownerId, projectId, readyMovieId)).rejects.toMatchObject({
      code: "PUBLICATION_DESTINATION_UNAVAILABLE",
    });
  });

  it("does not silently publish on keep success or watch open", async () => {
    const before = await prisma.publication.count({ where: { movieId: readyMovieId } });
    const kept = await movies.keep(ownerId, projectId, { renderJobId: succeededId, title: "No auto publish" });
    if (isMovieKeepAccepted(kept)) {
      throw new Error("expected sync keep");
    }
    const session = await playback.open(ownerId, projectId, { finishedMovieId: readyMovieId });
    await playback.close(ownerId, projectId, session.sessionId);
    expect(await prisma.publication.count({ where: { movieId: readyMovieId } })).toBe(before);
    expect(await prisma.publication.count({ where: { movieId: kept.id } })).toBe(0);
  });

  it("preserves multiple publications per movie and prior rows", async () => {
    const first = await service.exportDownload(ownerId, projectId, readyMovieId);
    const second = await service.createShareLink(ownerId, projectId, readyMovieId);
    if (isPublicationAccepted(first) || isPublicationAccepted(second)) {
      throw new Error("expected sync publications");
    }
    const listed = await service.list(ownerId, projectId, readyMovieId);
    expect(listed.some((row) => row.id === first.publication.id)).toBe(true);
    expect(listed.some((row) => row.id === second.publication.id)).toBe(true);
    first.stream.stream.destroy();
  });

  it("enqueues PUBLISH and returns ACCEPTED for async destinations", async () => {
    const accepted = await service.exportDownload(ownerId, projectId, readyMovieId, { async: true });
    expect(isPublicationAccepted(accepted)).toBe(true);
    if (!isPublicationAccepted(accepted)) {
      throw new Error("expected async export");
    }
    const job = await jobs.get(accepted.jobId);
    expect(job?.type).toBe(JobType.PUBLISH);
    expect(job?.status).toBe(JobStatus.PENDING);

    const processed = await worker.drain();
    expect(processed).toBeGreaterThan(0);
    const status = await service.getJobStatus(ownerId, projectId, accepted.jobId);
    expect(status.status).toBe(JobStatus.SUCCEEDED);
    expect(status.publicationId).toBeTruthy();
    const publication = await service.get(ownerId, projectId, status.publicationId!);
    expect(publication.status).toBe(PublicationStatus.PUBLISHED);
    expect(publication.destinationKey).toBe(PublicationDestination.DOWNLOAD);
  });

  it("advertises canExport / canShareLink honestly", async () => {
    const availability = await service.getAvailability(ownerId, projectId, readyMovieId);
    expect(availability.canExport).toBe(true);
    expect(availability.canShareLink).toBe(true);
    expect(availability.movieReady).toBe(true);

    const archived = await service.getAvailability(ownerId, projectId, archivedMovieId);
    expect(archived.canExport).toBe(false);
    expect(archived.canShareLink).toBe(false);
    expect(archived.movieReady).toBe(false);

    const disabled = new PublicationService(
      jobs,
      storage,
      projects,
      new PublicationAdapterRegistry(),
      tokens,
      { storageReadable: () => false, shareTokenConfigured: () => false },
    );
    const denied = await disabled.getAvailability(ownerId, projectId, readyMovieId);
    expect(denied.canExport).toBe(false);
    expect(denied.canShareLink).toBe(false);
  });

  it("does not create a public CDN or vendor URL as domain truth", async () => {
    const created = await service.createShareLink(ownerId, projectId, readyMovieId);
    if (isPublicationAccepted(created)) {
      throw new Error("expected sync share");
    }
    const row = await prisma.finishedMovie.findUniqueOrThrow({ where: { id: readyMovieId } });
    expect(row.storageKey).toBe(libraryStorageKey(projectId, readyMovieId));
    expect(row.storageKey).not.toMatch(/^https?:\/\//);
    expect(created.shareUrl).toMatch(/\/watch\//);
    expect(created.shareUrl).not.toMatch(/cdn\.|s3\.amazonaws|storage\.googleapis/i);
    expect(JSON.stringify(created.publication)).not.toMatch(/https?:\/\/cdn/i);
  });

  it("lets a recipient watch-only and does not expose project keep/share chrome in the session", async () => {
    const created = await service.createShareLink(ownerId, projectId, readyMovieId);
    if (isPublicationAccepted(created)) {
      throw new Error("expected sync share");
    }
    const session = await playback.openWithShareToken(created.token);
    expect(session.streamPath?.startsWith("/api/share/")).toBe(true);
    expect(session).not.toHaveProperty("projectId");
    expect(session).not.toHaveProperty("storageKey");
    expect(session).not.toHaveProperty("shareToken");
    await expect(
      playback.open(ownerId, projectId, { shareToken: created.token, finishedMovieId: readyMovieId }),
    ).rejects.toMatchObject({ code: "PLAYBACK_INPUT_INVALID" });
  });

  it("denies export when produced duration exceeds the free max", async () => {
    await prisma.finishedMovie.update({
      where: { id: readyMovieId },
      data: { durationMs: 301_000 },
    });
    try {
      await expect(service.exportDownload(ownerId, projectId, readyMovieId)).rejects.toMatchObject({
        code: "DURATION_EXCEEDS_PLAN",
      });
    } finally {
      await prisma.finishedMovie.update({
        where: { id: readyMovieId },
        data: { durationMs: 4000 },
      });
    }
  });

  it("hardens Publication status and leaves PHASE locks untouched", async () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/PENDING \| PUBLISHED \| FAILED \| REVOKED/);
    expect(schema).toMatch(/destinationKey is an open adapter string/);
    expect(schema).not.toMatch(/enum Destination/);
    expect(schema).not.toMatch(/AI_PUBLISH|AI_SHARE/);

    const lock = readFileSync(path.join(process.cwd(), "PHASE_M6_FINISHED_MOVIE_ROADMAP_DECISION.md"), "utf8");
    expect(lock).toContain("M6");
    const m5 = readFileSync(path.join(process.cwd(), "PHASE_M5_PLAYBACK_ROADMAP_DECISION.md"), "utf8");
    expect(m5).toContain("M5");
  });
});
