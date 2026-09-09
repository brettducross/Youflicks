import "server-only";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import { FinishedMovieStatus, RenderJobStatus } from "@/server/domain/status";
import { assertLibraryStorageKey } from "@/server/movie/opaque-key";
import type { PlaybackPort } from "@/server/ports/playback";
import type { StoragePort, StorageReadRange } from "@/server/ports/storage";
import { assertOpaqueStorageKey } from "@/server/playback/opaque-key";
import { assertPlaybackOpenInputPrivacy, assertPlaybackSessionPrivacy } from "@/server/playback/privacy";
import type {
  PlaybackAvailability,
  PlaybackOpenInput,
  PlaybackSession,
  PlaybackStatus,
  PlaybackSurface,
} from "@/server/playback/schema";
import { PlaybackSessionStore } from "@/server/playback/sessions";
import { ProjectService } from "@/server/services/projects";

export type PlaybackOpenRequest = {
  renderJobId?: string;
  finishedMovieId?: string;
  startMs?: number;
  surface?: PlaybackSurface;
};

/**
 * M5 playback + M6 kept-film watch. Owner watches a SUCCEEDED RenderJob or a
 * READY FinishedMovie through PlaybackPort. Sessions are ephemeral.
 * Does not write FinishedMovie or Publication. Does not invent AI_PLAYBACK jobs.
 */
export class PlaybackService {
  constructor(
    private readonly storage: StoragePort,
    private readonly projects: ProjectService,
    private readonly sessions: PlaybackSessionStore,
    private readonly web: PlaybackPort,
    private readonly native: PlaybackPort,
    private readonly nativeAvailable: () => boolean,
  ) {}

  getAvailability(): PlaybackAvailability {
    return {
      webAvailable: true,
      nativeAvailable: this.nativeAvailable(),
      canWatch: true,
    };
  }

  async open(userId: string, projectId: string, body: PlaybackOpenRequest = {}): Promise<PlaybackSession> {
    await this.projects.getForUser(userId, projectId);

    if (body.renderJobId && body.finishedMovieId) {
      throw AppError.playbackInputInvalid("Watch either a render or a kept film, not both.");
    }

    if (body.startMs !== undefined && (!Number.isFinite(body.startMs) || body.startMs < 0)) {
      throw AppError.playbackInputInvalid("startMs must be a non-negative number.");
    }

    const source = body.finishedMovieId
      ? await this.requireKeptMovie(projectId, body.finishedMovieId)
      : await this.resolveRenderSource(projectId, body.renderJobId);

    const exists = await this.storage.exists(source.outputKey);
    if (!exists) {
      throw AppError.playbackSourceMissing();
    }

    const input: PlaybackOpenInput = {
      projectId,
      renderJobId: source.renderJobId,
      finishedMovieId: source.finishedMovieId,
      startMs: body.startMs,
    };
    assertPlaybackOpenInputPrivacy(input);

    const surface: PlaybackSurface = body.surface === "native" ? "native" : "web";
    const adapter = surface === "native" ? this.native : this.web;
    const session = await adapter.open(input, {
      viewerId: userId,
      outputKey: source.outputKey,
      mimeType: source.mimeType,
      durationMs: source.durationMs,
      byteSize: source.byteSize,
    });
    assertPlaybackSessionPrivacy(session);

    logger.info("playback.opened", {
      userId,
      projectId,
      renderJobId: source.renderJobId,
      finishedMovieId: source.finishedMovieId,
      transport: session.transport,
      surface,
    });
    return session;
  }

  async getStatus(userId: string, projectId: string, sessionId: string): Promise<PlaybackStatus> {
    await this.projects.getForUser(userId, projectId);
    const record = this.safeRead(sessionId);
    if (record && (record.viewerId !== userId || record.projectId !== projectId)) {
      throw AppError.forbidden("You cannot access this watch session.");
    }
    return this.web.getStatus(sessionId);
  }

  async close(userId: string, projectId: string, sessionId: string): Promise<PlaybackStatus> {
    await this.projects.getForUser(userId, projectId);
    const record = this.safeRead(sessionId);
    if (record && (record.viewerId !== userId || record.projectId !== projectId)) {
      throw AppError.forbidden("You cannot access this watch session.");
    }
    await this.web.close(sessionId);
    logger.info("playback.closed", { userId, projectId, sessionId: sessionId.slice(0, 12) });
    return this.web.getStatus(sessionId);
  }

  async openStream(
    userId: string,
    projectId: string,
    sessionId: string,
    range?: StorageReadRange,
  ) {
    await this.projects.getForUser(userId, projectId);
    const record = this.sessions.read(sessionId);
    if (record.viewerId !== userId || record.projectId !== projectId) {
      throw AppError.forbidden("You cannot access this watch session.");
    }
    if (record.transport !== "APP_STREAM") {
      throw AppError.playbackSessionInvalid("This watch session is not a stream.");
    }

    const source = record.finishedMovieId
      ? await this.requireKeptMovie(projectId, record.finishedMovieId)
      : await this.resolveRenderStream(projectId, record.renderJobId);

    if (source.outputKey !== record.outputKey) {
      throw AppError.playbackSessionInvalid("That watch session no longer matches the film.");
    }

    const stream = await this.storage.getStream(source.outputKey, range);
    if (!stream) {
      throw AppError.playbackSourceMissing();
    }

    logger.info("playback.stream", {
      userId,
      projectId,
      renderJobId: source.renderJobId,
      finishedMovieId: source.finishedMovieId,
      ranged: Boolean(range),
    });

    return {
      mimeType: record.mimeType || source.mimeType || "video/mp4",
      filename: "movie.mp4",
      stream,
    };
  }

  private safeRead(sessionId: string) {
    try {
      return this.sessions.read(sessionId);
    } catch {
      return null;
    }
  }

  private async resolveRenderSource(projectId: string, renderJobId?: string) {
    const render = renderJobId
      ? await this.requireRenderJob(projectId, renderJobId)
      : await this.requireLatestSucceeded(projectId);
    return {
      renderJobId: render.id,
      finishedMovieId: undefined as string | undefined,
      outputKey: assertOpaqueStorageKey(render.outputKey ?? ""),
      mimeType: render.mimeType ?? "video/mp4",
      durationMs: render.durationMs ?? 0,
      byteSize: render.byteSize !== null && render.byteSize !== undefined ? Number(render.byteSize) : undefined,
    };
  }

  private async resolveRenderStream(projectId: string, renderJobId: string) {
    const render = await this.requireRenderJob(projectId, renderJobId);
    return {
      renderJobId: render.id,
      finishedMovieId: undefined as string | undefined,
      outputKey: assertOpaqueStorageKey(render.outputKey ?? ""),
      mimeType: render.mimeType ?? "video/mp4",
    };
  }

  private async requireKeptMovie(projectId: string, finishedMovieId: string) {
    const row = await prisma.finishedMovie.findFirst({
      where: { id: finishedMovieId, projectId },
    });
    if (!row) {
      throw AppError.notFound("That film was not found.");
    }
    if (row.status !== FinishedMovieStatus.READY) {
      throw AppError.movieNotReady();
    }
    if (!row.storageKey) {
      throw AppError.playbackOutputInvalid("A kept film must have an opaque library storage key.");
    }
    const outputKey = assertLibraryStorageKey(row.storageKey);
    return {
      renderJobId: row.renderJobId,
      finishedMovieId: row.id,
      outputKey,
      mimeType: row.mimeType ?? "video/mp4",
      durationMs: row.durationMs ?? 0,
      byteSize: row.byteSize !== null && row.byteSize !== undefined ? Number(row.byteSize) : undefined,
    };
  }

  private async requireLatestSucceeded(projectId: string) {
    const row = await prisma.renderJob.findFirst({
      where: { projectId, status: RenderJobStatus.SUCCEEDED },
      orderBy: { createdAt: "desc" },
    });
    if (!row) {
      throw AppError.playbackRenderRequired();
    }
    return this.assertPlayable(row);
  }

  private async requireRenderJob(projectId: string, renderJobId: string) {
    const row = await prisma.renderJob.findFirst({
      where: { id: renderJobId, projectId },
    });
    if (!row) {
      throw AppError.notFound("That render was not found.");
    }
    return this.assertPlayable(row);
  }

  private assertPlayable(row: {
    id: string;
    status: string;
    outputKey: string | null;
    mimeType: string | null;
    durationMs: number | null;
    byteSize: bigint | null;
  }) {
    if (row.status !== RenderJobStatus.SUCCEEDED) {
      throw AppError.playbackRenderRequired("Only a successful render can be watched.");
    }
    if (!row.outputKey) {
      throw AppError.playbackOutputInvalid("A successful render must have an opaque storage key.");
    }
    assertOpaqueStorageKey(row.outputKey);
    return row;
  }
}
