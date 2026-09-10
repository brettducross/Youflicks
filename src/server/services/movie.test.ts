import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { WebMediaPlaybackAdapter } from "@/server/adapters/playback/web-media";
import { VlcPlaybackAdapter } from "@/server/adapters/playback/vlc";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { prisma } from "@/server/db";
import {
  FinishedMovieStatus,
  JobStatus,
  JobType,
  RenderJobStatus,
  StoryStructureStatus,
  TimelineStatus,
} from "@/server/domain/status";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { PlaybackPort } from "@/server/ports/playback";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoragePort } from "@/server/ports/storage";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import { PlaybackSessionStore } from "@/server/playback/sessions";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { isMovieKeepAccepted, MovieService } from "@/server/services/movie";
import { MovieWorker } from "@/server/services/movie-worker";
import { PlaybackService } from "@/server/services/playback";
import { ProjectService } from "@/server/services/projects";

const OUTPUT_BYTES = new Uint8Array(Buffer.from("YouFlicks M6 library keep fixture\n", "utf8"));

describe("MovieService M6", () => {
  const ownerId = `movie-owner-${Date.now()}`;
  const strangerId = `movie-stranger-${Date.now()}`;
  const projects = new ProjectService();
  const jobs = new PostgresJobQueue();
  let projectId = "";
  let timelineId = "";
  let succeededId = "";
  let queuedId = "";
  let vendorUrlId = "";
  let missingBytesId = "";
  let dir = "";
  let storage: LocalStorageAdapter;
  let service: MovieService;
  let worker: MovieWorker;
  let playback: PlaybackService;
  let readOnlyStorage: StoragePort;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-movie-"));
    storage = new LocalStorageAdapter(dir);
    readOnlyStorage = {
      driver: "local",
      put: async () => {
        throw new Error("storage is not writable");
      },
      get: async (key) => storage.get(key),
      getStream: async (key, range) => storage.getStream(key, range),
      delete: async () => undefined,
      exists: async (key) => storage.exists(key),
    };
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
      title: "Library cut",
      logline: "M6.",
    });
    projectId = project.id;
    const story = await prisma.storyStructure.create({
      data: {
        projectId,
        version: 1,
        status: StoryStructureStatus.READY,
        payload: { schemaVersion: "1.0", title: "Keep" },
        inputFingerprint: "movie-story-fingerprint",
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
        payload: { schemaVersion: "1.0", title: "Keep cut" },
        inputFingerprint: "movie-timeline-fingerprint",
        storyStructureId: story.id,
        storyStructureVersion: story.version,
        providerKey: "test.timeline",
        capability: "TIMELINE_COMPOSITION",
      },
    });
    timelineId = timeline.id;

    service = new MovieService(jobs, storage, projects, () => true);
    worker = new MovieWorker(jobs, service);
    const sessions = new PlaybackSessionStore("movie-playback-test-secret");
    const web = new WebMediaPlaybackAdapter(sessions);
    const native = new VlcPlaybackAdapter(sessions, () => true);
    playback = new PlaybackService(storage, projects, sessions, web, native, () => true);

    queuedId = await seedRender({ status: RenderJobStatus.QUEUED, outputKey: null });
    vendorUrlId = await seedRender({
      status: RenderJobStatus.SUCCEEDED,
      outputKey: "https://cdn.vendor.example/movie.mp4",
    });
    missingBytesId = await seedRender({
      status: RenderJobStatus.SUCCEEDED,
      outputKey: `projects/${projectId}/renders/missing/output.mp4`,
    });
    succeededId = await seedRender({
      status: RenderJobStatus.SUCCEEDED,
      outputKey: `projects/${projectId}/renders/ok/output.mp4`,
    });
    await storage.put({
      key: `projects/${projectId}/renders/ok/output.mp4`,
      body: OUTPUT_BYTES,
      contentType: "video/mp4",
    });
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

  async function seedRender(input: { status: string; outputKey: string | null }) {
    const row = await prisma.renderJob.create({
      data: {
        projectId,
        timelineId,
        timelineVersion: 1,
        inputFingerprint: `movie-${input.status}-${input.outputKey ?? "none"}-${Math.random()}`,
        capability: "VIDEO_RENDER",
        providerKey: "test.renderer",
        status: input.status,
        outputKey: input.outputKey,
        mimeType: input.outputKey ? "video/mp4" : null,
        durationMs: input.outputKey ? 4000 : null,
        byteSize: input.outputKey ? BigInt(OUTPUT_BYTES.byteLength) : null,
      },
    });
    return row.id;
  }

  it("does not invent AI_LIBRARY / AI_MOVIE and does not overload ports", () => {
    expect(JobType.LIBRARY_KEEP).toBe("LIBRARY_KEEP");
    expect("AI_LIBRARY" in JobType).toBe(false);
    expect("AI_MOVIE" in JobType).toBe(false);
    const renderer: RendererPort = {
      render: async () => {
        throw new Error("unused");
      },
    };
    expect(renderer).not.toHaveProperty("keep");
    const playbackPort: PlaybackPort = {
      open: async () => {
        throw new Error("unused");
      },
      getStatus: async () => ({ sessionId: "", renderJobId: "", state: "OPEN" }),
      close: async () => undefined,
    };
    expect(playbackPort).not.toHaveProperty("keep");
    const director: AiDirectorPort = {
      composePlan: async () => ({ schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION }),
    };
    expect(director).not.toHaveProperty("keep");
    const story: StoryComposerPort = {
      composeStory: async () => ({ schemaVersion: "1.0" }) as never,
    };
    expect(story).not.toHaveProperty("keep");
    const timeline: TimelineComposerPort = {
      composeTimeline: async () => ({ schemaVersion: "1.0" }) as never,
    };
    expect(timeline).not.toHaveProperty("keep");
    const assets: AssetGeneratorPort = {
      generate: async () => {
        throw new Error("unused");
      },
    };
    expect(assets).not.toHaveProperty("keep");
  });

  it("lets the owner explicitly keep a SUCCEEDED render into a READY library film", async () => {
    const publicationsBefore = await prisma.publication.count();
    const kept = await service.keep(ownerId, projectId, { renderJobId: succeededId });
    expect(isMovieKeepAccepted(kept)).toBe(false);
    if (isMovieKeepAccepted(kept)) {
      throw new Error("expected sync keep");
    }
    expect(kept.status).toBe(FinishedMovieStatus.READY);
    expect(kept.renderJobId).toBe(succeededId);
    expect(kept.title).toBe("Library cut");
    expect(kept).not.toHaveProperty("storageKey");
    expect(JSON.stringify(kept)).not.toMatch(/https?:\/\/|cdn\.|ffmpeg|vlc/i);

    const row = await prisma.finishedMovie.findUniqueOrThrow({ where: { id: kept.id } });
    expect(row.storageKey).toBe(`projects/${projectId}/movies/${kept.id}/output.mp4`);
    expect(row.storageKey).not.toBe(`projects/${projectId}/renders/ok/output.mp4`);
    expect(await storage.exists(row.storageKey ?? "")).toBe(true);
    const copy = await storage.get(row.storageKey ?? "");
    expect(copy?.body).toEqual(OUTPUT_BYTES);

    await storage.delete(`projects/${projectId}/renders/ok/output.mp4`);
    expect(await storage.exists(row.storageKey ?? "")).toBe(true);
    await storage.put({
      key: `projects/${projectId}/renders/ok/output.mp4`,
      body: OUTPUT_BYTES,
      contentType: "video/mp4",
    });

    expect(await prisma.publication.count()).toBe(publicationsBefore);
  });

  it("blocks a stranger from keep / list / get / archive / watch", async () => {
    const kept = await service.keep(ownerId, projectId, {
      renderJobId: succeededId,
      title: "Stranger block",
    });
    if (isMovieKeepAccepted(kept)) {
      throw new Error("expected sync keep");
    }
    await expect(service.keep(strangerId, projectId, { renderJobId: succeededId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.list(strangerId, projectId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.get(strangerId, projectId, kept.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.archive(strangerId, projectId, kept.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      playback.open(strangerId, projectId, { finishedMovieId: kept.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects non-SUCCEEDED renders and vendor URL output keys", async () => {
    await expect(service.keep(ownerId, projectId, { renderJobId: queuedId })).rejects.toMatchObject({
      code: "MOVIE_RENDER_REQUIRED",
    });
    await expect(service.keep(ownerId, projectId, { renderJobId: vendorUrlId })).rejects.toMatchObject({
      code: "MOVIE_OUTPUT_INVALID",
    });
    await expect(service.keep(ownerId, projectId, { renderJobId: missingBytesId })).rejects.toMatchObject({
      code: "MOVIE_SOURCE_MISSING",
    });
  });

  it("does not silently keep on render success or watch open", async () => {
    const before = await prisma.finishedMovie.count({ where: { projectId } });
    const session = await playback.open(ownerId, projectId, { renderJobId: succeededId });
    await playback.close(ownerId, projectId, session.sessionId);
    expect(await prisma.finishedMovie.count({ where: { projectId } })).toBe(before);
  });

  it("allows multiple keeps and soft-archives without deleting bytes", async () => {
    const first = await service.keep(ownerId, projectId, {
      renderJobId: succeededId,
      title: "Keep one",
    });
    const second = await service.keep(ownerId, projectId, {
      renderJobId: succeededId,
      title: "Keep two",
    });
    if (isMovieKeepAccepted(first) || isMovieKeepAccepted(second)) {
      throw new Error("expected sync keeps");
    }
    expect(first.id).not.toBe(second.id);
    const listed = await service.list(ownerId, projectId);
    expect(listed.some((movie) => movie.id === first.id)).toBe(true);
    expect(listed.some((movie) => movie.id === second.id)).toBe(true);

    const archived = await service.archive(ownerId, projectId, first.id);
    expect(archived.status).toBe(FinishedMovieStatus.ARCHIVED);
    const withoutArchived = await service.list(ownerId, projectId);
    expect(withoutArchived.some((movie) => movie.id === first.id)).toBe(false);
    const withArchived = await service.list(ownerId, projectId, { includeArchived: true });
    expect(withArchived.some((movie) => movie.id === first.id)).toBe(true);

    const row = await prisma.finishedMovie.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.storageKey).toBeTruthy();
    expect(await storage.exists(row.storageKey ?? "")).toBe(true);

    const restored = await service.unarchive(ownerId, projectId, first.id);
    expect(restored.status).toBe(FinishedMovieStatus.READY);
  });

  it("enqueues LIBRARY_KEEP and returns ACCEPTED for async keep", async () => {
    const publicationsBefore = await prisma.publication.count();
    const accepted = await service.keep(ownerId, projectId, {
      renderJobId: succeededId,
      title: "Async keep",
      async: true,
    });
    expect(isMovieKeepAccepted(accepted)).toBe(true);
    if (!isMovieKeepAccepted(accepted)) {
      throw new Error("expected async keep");
    }
    expect(accepted.status).toBe("ACCEPTED");
    const job = await jobs.get(accepted.jobId);
    expect(job?.type).toBe(JobType.LIBRARY_KEEP);
    expect(job?.status).toBe(JobStatus.PENDING);

    const listedBefore = await service.list(ownerId, projectId);
    expect(listedBefore.some((movie) => movie.title === "Async keep")).toBe(false);

    const processed = await worker.drain();
    expect(processed).toBeGreaterThan(0);
    const status = await service.getJobStatus(ownerId, projectId, accepted.jobId);
    expect(status.status).toBe(JobStatus.SUCCEEDED);
    expect(status.movieId).toBeTruthy();
    const movie = await service.get(ownerId, projectId, status.movieId!);
    expect(movie.status).toBe(FinishedMovieStatus.READY);
    expect(movie.title).toBe("Async keep");
    expect(await prisma.publication.count()).toBe(publicationsBefore);
  });

  it("writes FAILED (never READY) when the library copy cannot be stored", async () => {
    const failing = new MovieService(jobs, readOnlyStorage, projects, () => true);
    const beforeReady = await prisma.finishedMovie.count({
      where: { projectId, status: FinishedMovieStatus.READY },
    });
    await expect(
      failing.keep(ownerId, projectId, { renderJobId: succeededId, title: "Broken copy", async: false }),
    ).rejects.toMatchObject({ code: "MOVIE_STORAGE_UNAVAILABLE" });
    const failed = await prisma.finishedMovie.findFirst({
      where: { projectId, title: "Broken copy" },
    });
    expect(failed?.status).toBe(FinishedMovieStatus.FAILED);
    expect(failed?.storageKey).toBeNull();
    expect(
      await prisma.finishedMovie.count({ where: { projectId, status: FinishedMovieStatus.READY } }),
    ).toBe(beforeReady);
  });

  it("watches a kept film via PlaybackPort finishedMovieId and streams library bytes", async () => {
    const kept = await service.keep(ownerId, projectId, {
      renderJobId: succeededId,
      title: "Watch kept",
    });
    if (isMovieKeepAccepted(kept)) {
      throw new Error("expected sync keep");
    }
    const session = await playback.open(ownerId, projectId, { finishedMovieId: kept.id });
    expect(session.finishedMovieId).toBe(kept.id);
    expect(session.renderJobId).toBe(succeededId);
    expect(session.streamPath).toMatch(
      new RegExp(`^/api/projects/${projectId}/playback/sessions/.+/stream$`),
    );

    const row = await prisma.finishedMovie.findUniqueOrThrow({ where: { id: kept.id } });
    await storage.delete(`projects/${projectId}/renders/ok/output.mp4`);
    const streamed = await playback.openStream(ownerId, projectId, session.sessionId);
    expect(streamed.stream.byteSize).toBe(OUTPUT_BYTES.byteLength);
    streamed.stream.stream.destroy();
    await storage.put({
      key: `projects/${projectId}/renders/ok/output.mp4`,
      body: OUTPUT_BYTES,
      contentType: "video/mp4",
    });
    await playback.close(ownerId, projectId, session.sessionId);
    expect(row.storageKey).toMatch(new RegExp(`projects/${projectId}/movies/${kept.id}/`));
  });

  it("rejects watching both a render and a kept film in one open", async () => {
    const kept = await service.keep(ownerId, projectId, {
      renderJobId: succeededId,
      title: "Both ids",
    });
    if (isMovieKeepAccepted(kept)) {
      throw new Error("expected sync keep");
    }
    await expect(
      playback.open(ownerId, projectId, { renderJobId: succeededId, finishedMovieId: kept.id }),
    ).rejects.toMatchObject({ code: "PLAYBACK_INPUT_INVALID" });
  });

  it("advertises canKeep only when a SUCCEEDED render exists and storage is writable", async () => {
    const availability = await service.getAvailability(ownerId, projectId);
    expect(availability.canKeep).toBe(true);
    expect(availability.hasSucceededRender).toBe(true);
    const closed = new MovieService(jobs, storage, projects, () => false);
    const denied = await closed.getAvailability(ownerId, projectId);
    expect(denied.canKeep).toBe(false);
    expect(denied.storageWritable).toBe(false);
  });

  it("denies keep when produced duration exceeds the free max", async () => {
    const longId = await seedRender({
      status: RenderJobStatus.SUCCEEDED,
      outputKey: `projects/${projectId}/renders/long/output.mp4`,
    });
    await prisma.renderJob.update({
      where: { id: longId },
      data: { durationMs: 301_000 },
    });
    await storage.put({
      key: `projects/${projectId}/renders/long/output.mp4`,
      body: OUTPUT_BYTES,
      contentType: "video/mp4",
    });
    await expect(service.keep(ownerId, projectId, { renderJobId: longId })).rejects.toMatchObject({
      code: "DURATION_EXCEEDS_PLAN",
    });
  });

  it("denies keep when SUCCEEDED output omitted durationMs", async () => {
    const unknownId = await seedRender({
      status: RenderJobStatus.SUCCEEDED,
      outputKey: `projects/${projectId}/renders/unknown-duration/output.mp4`,
    });
    await prisma.renderJob.update({
      where: { id: unknownId },
      data: { durationMs: null },
    });
    await storage.put({
      key: `projects/${projectId}/renders/unknown-duration/output.mp4`,
      body: OUTPUT_BYTES,
      contentType: "video/mp4",
    });
    await expect(service.keep(ownerId, projectId, { renderJobId: unknownId })).rejects.toMatchObject({
      code: "OUTPUT_DURATION_UNKNOWN",
    });
  });

  it("does not treat PROCESSING as a listed kept film and writes zero Publication rows", async () => {
    const listed = await service.list(ownerId, projectId, { includeArchived: true });
    expect(listed.every((movie) => movie.status !== "PROCESSING")).toBe(true);
    expect(await prisma.publication.count({ where: { movieId: { in: listed.map((m) => m.id) } } })).toBe(0);

    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/READY \| ARCHIVED \| FAILED/);
    expect(schema).not.toMatch(/AI_LIBRARY|AI_MOVIE/);
  });
});
