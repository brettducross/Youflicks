import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebMediaPlaybackAdapter } from "@/server/adapters/playback/web-media";
import { VlcPlaybackAdapter } from "@/server/adapters/playback/vlc";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { prisma } from "@/server/db";
import { JobType, RenderJobStatus, StoryStructureStatus, TimelineStatus } from "@/server/domain/status";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { PlaybackPort } from "@/server/ports/playback";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import { PlaybackSessionStore } from "@/server/playback/sessions";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { PlaybackService } from "@/server/services/playback";
import { ProjectService } from "@/server/services/projects";

const OUTPUT_BYTES = new Uint8Array(Buffer.from("YouFlicks M5 playback fixture\n", "utf8"));

describe("PlaybackService M5", () => {
  const ownerId = `playback-owner-${Date.now()}`;
  const strangerId = `playback-stranger-${Date.now()}`;
  const projects = new ProjectService();
  let projectId = "";
  let timelineId = "";
  let succeededId = "";
  let queuedId = "";
  let vendorUrlId = "";
  let missingBytesId = "";
  let dir = "";
  let storage: LocalStorageAdapter;
  let service: PlaybackService;
  let nativeUnavailable: PlaybackService;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-playback-"));
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
      title: "Playback cut",
      logline: "M5.",
    });
    projectId = project.id;
    const story = await prisma.storyStructure.create({
      data: {
        projectId,
        version: 1,
        status: StoryStructureStatus.READY,
        payload: { schemaVersion: "1.0", title: "Watch" },
        inputFingerprint: "playback-story-fingerprint",
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
        payload: { schemaVersion: "1.0", title: "Watch cut" },
        inputFingerprint: "playback-timeline-fingerprint",
        storyStructureId: story.id,
        storyStructureVersion: story.version,
        providerKey: "test.timeline",
        capability: "TIMELINE_COMPOSITION",
      },
    });
    timelineId = timeline.id;

    const sessions = new PlaybackSessionStore("playback-service-test-secret");
    const web = new WebMediaPlaybackAdapter(sessions);
    const native = new VlcPlaybackAdapter(sessions, () => true);
    const nativeOff = new VlcPlaybackAdapter(sessions, () => false);
    service = new PlaybackService(storage, projects, sessions, web, native, () => true);
    nativeUnavailable = new PlaybackService(storage, projects, sessions, web, nativeOff, () => false);

    queuedId = await seedRender({
      status: RenderJobStatus.QUEUED,
      outputKey: null,
    });
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
    await prisma.renderJob.deleteMany({ where: { projectId } });
    await prisma.timeline.deleteMany({ where: { projectId } });
    await prisma.storyStructure.deleteMany({ where: { projectId } });
    await prisma.finishedMovie.deleteMany({ where: { projectId } });
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
        inputFingerprint: `playback-${input.status}-${input.outputKey ?? "none"}`,
        capability: "VIDEO_RENDER",
        providerKey: "test.renderer",
        status: input.status,
        outputKey: input.outputKey,
        mimeType: input.outputKey ? "video/mp4" : null,
        durationMs: input.outputKey ? 3000 : null,
        byteSize: input.outputKey ? BigInt(OUTPUT_BYTES.byteLength) : null,
      },
    });
    return row.id;
  }

  it("does not invent AI_PLAYBACK and does not overload upstream ports", () => {
    expect("AI_PLAYBACK" in JobType).toBe(false);
    expect("PLAYBACK_PREPARE" in JobType).toBe(false);
    const renderer: RendererPort = {
      render: async () => {
        throw new Error("unused");
      },
    };
    expect(renderer).not.toHaveProperty("open");
    const director: AiDirectorPort = {
      composePlan: async () => ({ schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION }),
    };
    expect(director).not.toHaveProperty("open");
    const story: StoryComposerPort = {
      composeStory: async () => ({ schemaVersion: "1.0" }) as never,
    };
    expect(story).not.toHaveProperty("open");
    const timeline: TimelineComposerPort = {
      composeTimeline: async () => ({ schemaVersion: "1.0" }) as never,
    };
    expect(timeline).not.toHaveProperty("open");
    const assets: AssetGeneratorPort = {
      generate: async () => {
        throw new Error("unused");
      },
    };
    expect(assets).not.toHaveProperty("open");
    const playback: PlaybackPort = {
      open: async () => {
        throw new Error("unused");
      },
      getStatus: async () => ({ sessionId: "", renderJobId: "", state: "OPEN" }),
      close: async () => undefined,
    };
    expect(playback).not.toHaveProperty("render");
  });

  it("lets the owner open playback for a SUCCEEDED render", async () => {
    const session = await service.open(ownerId, projectId, { renderJobId: succeededId });
    expect(session.renderJobId).toBe(succeededId);
    expect(session.transport).toBe("APP_STREAM");
    expect(session.streamPath).toMatch(
      new RegExp(`^/api/projects/${projectId}/playback/sessions/.+/stream$`),
    );
    expect(session).not.toHaveProperty("outputKey");
    expect(JSON.stringify(session)).not.toMatch(/https?:\/\/|cdn\.|vlc|libvlc|ffmpeg/i);

    const streamed = await service.openStream(ownerId, projectId, session.sessionId);
    expect(streamed.mimeType).toBe("video/mp4");
    expect(streamed.stream.byteSize).toBe(OUTPUT_BYTES.byteLength);
    streamed.stream.stream.destroy();

    const ranged = await service.openStream(ownerId, projectId, session.sessionId, {
      start: 0,
      end: 8,
    });
    expect(ranged.stream.contentLength).toBe(9);
    ranged.stream.stream.destroy();

    const status = await service.close(ownerId, projectId, session.sessionId);
    expect(status.state).toBe("CLOSED");
    await expect(service.openStream(ownerId, projectId, session.sessionId)).rejects.toMatchObject({
      code: "PLAYBACK_SESSION_INVALID",
    });
  });

  it("opens the latest SUCCEEDED render when renderJobId is omitted", async () => {
    const session = await service.open(ownerId, projectId, {});
    expect(session.renderJobId).toBe(succeededId);
    await service.close(ownerId, projectId, session.sessionId);
  });

  it("blocks a stranger from opening or streaming", async () => {
    await expect(service.open(strangerId, projectId, { renderJobId: succeededId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const session = await service.open(ownerId, projectId, { renderJobId: succeededId });
    await expect(service.openStream(strangerId, projectId, session.sessionId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await service.close(ownerId, projectId, session.sessionId);
  });

  it("rejects non-SUCCEEDED RenderJobs", async () => {
    await expect(service.open(ownerId, projectId, { renderJobId: queuedId })).rejects.toMatchObject({
      code: "PLAYBACK_RENDER_REQUIRED",
    });
  });

  it("rejects vendor URL outputKey as domain truth", async () => {
    await expect(service.open(ownerId, projectId, { renderJobId: vendorUrlId })).rejects.toMatchObject({
      code: "PLAYBACK_OUTPUT_INVALID",
    });
  });

  it("rejects missing storage bytes", async () => {
    await expect(service.open(ownerId, projectId, { renderJobId: missingBytesId })).rejects.toMatchObject({
      code: "PLAYBACK_SOURCE_MISSING",
    });
  });

  it("fails native honestly when VLC is unavailable; web still works", async () => {
    await expect(
      nativeUnavailable.open(ownerId, projectId, { renderJobId: succeededId, surface: "native" }),
    ).rejects.toMatchObject({
      code: "PLAYBACK_ADAPTER_UNAVAILABLE",
    });
    const session = await nativeUnavailable.open(ownerId, projectId, { renderJobId: succeededId });
    expect(session.transport).toBe("APP_STREAM");
    await nativeUnavailable.close(ownerId, projectId, session.sessionId);
  });

  it("opens native NATIVE_HANDLE sessions without a vendor stream URL", async () => {
    const session = await service.open(ownerId, projectId, {
      renderJobId: succeededId,
      surface: "native",
    });
    expect(session.transport).toBe("NATIVE_HANDLE");
    expect(session.streamPath).toBeUndefined();
    await expect(service.openStream(ownerId, projectId, session.sessionId)).rejects.toMatchObject({
      code: "PLAYBACK_SESSION_INVALID",
    });
    await service.close(ownerId, projectId, session.sessionId);
  });

  it("writes no FinishedMovie or Publication rows and does not add VLC Prisma columns", async () => {
    const moviesBefore = await prisma.finishedMovie.count({ where: { projectId } });
    const publicationsBefore = await prisma.publication.count();
    const session = await service.open(ownerId, projectId, { renderJobId: succeededId });
    await service.openStream(ownerId, projectId, session.sessionId).then((file) => file.stream.stream.destroy());
    await service.close(ownerId, projectId, session.sessionId);
    expect(await prisma.finishedMovie.count({ where: { projectId } })).toBe(moviesBefore);
    expect(await prisma.publication.count()).toBe(publicationsBefore);

    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).not.toMatch(/vlc|libvlc|AI_PLAYBACK/i);
    expect(schema).not.toMatch(/model PlaybackSession/);
  });

  it("advertises web watch without claiming a film library", () => {
    const availability = service.getAvailability();
    expect(availability.webAvailable).toBe(true);
    expect(availability.canWatch).toBe(true);
    expect(availability.nativeAvailable).toBe(true);
    expect(nativeUnavailable.getAvailability().nativeAvailable).toBe(false);
  });
});
