import "server-only";

import { randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import { FinishedMovieStatus, JobType, RenderJobStatus } from "@/server/domain/status";
import { checksumBytes, fingerprintLibraryKeep } from "@/server/movie/fingerprint";
import { assertLibraryStorageKey, assertRenderOutputKey } from "@/server/movie/opaque-key";
import { assertFinishedMovieViewPrivacy, assertMovieKeepInputPrivacy } from "@/server/movie/privacy";
import {
  libraryStorageKey,
  type FinishedMovieView,
  type MovieAvailability,
  type MovieJobStatusView,
  type MovieKeepAccepted,
  type MovieKeepInput,
} from "@/server/movie/schema";
import type { JobQueuePort, JobRecord } from "@/server/ports/jobs";
import type { StoragePort } from "@/server/ports/storage";
import { EntitlementService } from "@/server/services/entitlement";
import { ProjectService } from "@/server/services/projects";

export type LibraryKeepQueuePayload = {
  projectId: string;
  requestedBy: string;
  renderJobId: string;
  title: string;
  movieId: string;
};

/**
 * M6 library keep. Owner explicitly keeps a SUCCEEDED RenderJob into a
 * FinishedMovie with a durable StoragePort copy. Does not write Publication,
 * does not invent creative AI ports/jobs, and does not auto-keep on render
 * or watch.
 */
export class MovieService {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly storage: StoragePort,
    private readonly projects: ProjectService,
    private readonly storageWritable: () => boolean = () => true,
    private readonly entitlements: EntitlementService = new EntitlementService(),
  ) {}

  async getAvailability(userId: string, projectId: string): Promise<MovieAvailability> {
    await this.projects.getForUser(userId, projectId);
    const succeeded = await this.findLatestSucceeded(projectId);
    const writable = this.storageWritable();
    return {
      canKeep: Boolean(succeeded && writable),
      storageWritable: writable,
      hasSucceededRender: Boolean(succeeded),
    };
  }

  async keep(
    userId: string,
    projectId: string,
    body: MovieKeepInput = {},
  ): Promise<FinishedMovieView | MovieKeepAccepted> {
    const project = await this.projects.getForUser(userId, projectId);
    assertMovieKeepInputPrivacy(body);

    if (!this.storageWritable()) {
      throw AppError.movieStorageUnavailable();
    }

    const render = body.renderJobId
      ? await this.requireSucceededRender(projectId, body.renderJobId)
      : await this.requireLatestSucceeded(projectId);
    await this.entitlements.assertOutputDuration(userId, render.durationMs, projectId);

    const title = this.resolveTitle(body.title, project.title);
    const asyncKeep = body.async === true || (body.async !== false && this.storage.driver !== "local");

    if (asyncKeep) {
      return this.enqueueKeep(userId, projectId, render.id, title);
    }

    return this.performKeep(projectId, render.id, title);
  }

  async list(
    userId: string,
    projectId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<FinishedMovieView[]> {
    await this.projects.getForUser(userId, projectId);
    const statuses = options.includeArchived
      ? [FinishedMovieStatus.READY, FinishedMovieStatus.ARCHIVED, FinishedMovieStatus.FAILED]
      : [FinishedMovieStatus.READY, FinishedMovieStatus.FAILED];
    const rows = await prisma.finishedMovie.findMany({
      where: { projectId, status: { in: statuses } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async get(userId: string, projectId: string, movieId: string): Promise<FinishedMovieView> {
    await this.projects.getForUser(userId, projectId);
    const row = await this.requireMovie(projectId, movieId);
    return this.toView(row);
  }

  async archive(userId: string, projectId: string, movieId: string): Promise<FinishedMovieView> {
    await this.projects.getForUser(userId, projectId);
    const row = await this.requireMovie(projectId, movieId);
    if (row.status === FinishedMovieStatus.ARCHIVED) {
      return this.toView(row);
    }
    if (row.status !== FinishedMovieStatus.READY) {
      throw AppError.movieInputInvalid("Only a kept film can be archived.");
    }
    const updated = await prisma.finishedMovie.update({
      where: { id: row.id },
      data: { status: FinishedMovieStatus.ARCHIVED },
    });
    logger.info("movie.archived", { userId, projectId, movieId: row.id });
    return this.toView(updated);
  }

  async unarchive(userId: string, projectId: string, movieId: string): Promise<FinishedMovieView> {
    await this.projects.getForUser(userId, projectId);
    const row = await this.requireMovie(projectId, movieId);
    if (row.status === FinishedMovieStatus.READY) {
      return this.toView(row);
    }
    if (row.status !== FinishedMovieStatus.ARCHIVED) {
      throw AppError.movieInputInvalid("Only an archived film can be restored.");
    }
    if (!row.storageKey) {
      throw AppError.movieOutputInvalid("An archived film is missing its library file.");
    }
    const updated = await prisma.finishedMovie.update({
      where: { id: row.id },
      data: { status: FinishedMovieStatus.READY },
    });
    logger.info("movie.unarchived", { userId, projectId, movieId: row.id });
    return this.toView(updated);
  }

  async getJobStatus(userId: string, projectId: string, jobId: string): Promise<MovieJobStatusView> {
    await this.projects.getForUser(userId, projectId);
    const job = await this.jobs.get(jobId);
    if (!job || job.projectId !== projectId || job.type !== JobType.LIBRARY_KEEP) {
      throw AppError.notFound("That keep job was not found.");
    }
    return this.toJobStatus(job);
  }

  async processJob(job: JobRecord): Promise<{ movieId: string | null }> {
    const payload = job.payload as LibraryKeepQueuePayload | null;
    if (!payload?.projectId || !payload.requestedBy || !payload.renderJobId || !payload.movieId) {
      throw AppError.jobFailed("Keep job is missing project context.");
    }
    await this.projects.getForUser(payload.requestedBy, payload.projectId);
    const view = await this.performKeep(
      payload.projectId,
      payload.renderJobId,
      payload.title,
      payload.movieId,
    );
    return { movieId: view.id };
  }

  async markFailed(jobId: string, message: string) {
    const job = await this.jobs.get(jobId);
    const payload = job?.payload as LibraryKeepQueuePayload | null;
    if (!payload?.projectId || !payload.renderJobId || !payload.movieId) {
      return;
    }
    const existing = await prisma.finishedMovie.findFirst({
      where: { id: payload.movieId, projectId: payload.projectId },
    });
    if (existing) {
      if (existing.status === FinishedMovieStatus.READY) {
        return;
      }
      await prisma.finishedMovie.update({
        where: { id: existing.id },
        data: { status: FinishedMovieStatus.FAILED },
      });
      return;
    }
    await prisma.finishedMovie.create({
      data: {
        id: payload.movieId,
        projectId: payload.projectId,
        renderJobId: payload.renderJobId,
        title: payload.title || "Kept film",
        status: FinishedMovieStatus.FAILED,
      },
    });
    logger.error("movie.keep_failed", { jobId, movieId: payload.movieId, error: message });
  }

  toView(row: {
    id: string;
    projectId: string;
    renderJobId: string;
    title: string;
    status: string;
    durationMs: number | null;
    mimeType: string | null;
    byteSize: bigint | null;
    checksum: string | null;
    keptAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): FinishedMovieView {
    const view: FinishedMovieView = {
      id: row.id,
      projectId: row.projectId,
      renderJobId: row.renderJobId,
      title: row.title,
      status: row.status,
      durationMs: row.durationMs,
      mimeType: row.mimeType,
      byteSize: row.byteSize !== null ? Number(row.byteSize) : null,
      checksum: row.checksum,
      keptAt: row.keptAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    assertFinishedMovieViewPrivacy(view);
    return view;
  }

  private async enqueueKeep(
    userId: string,
    projectId: string,
    renderJobId: string,
    title: string,
  ): Promise<MovieKeepAccepted> {
    const movieId = createMovieId();
    const job = await this.jobs.enqueue({
      type: JobType.LIBRARY_KEEP,
      projectId,
      payload: {
        projectId,
        requestedBy: userId,
        renderJobId,
        title,
        movieId,
      } satisfies LibraryKeepQueuePayload,
    });
    logger.info("movie.keep_queued", { userId, projectId, jobId: job.id, renderJobId, movieId });
    return { jobId: job.id, status: "ACCEPTED" };
  }

  private async performKeep(
    projectId: string,
    renderJobId: string,
    title: string,
    movieId = createMovieId(),
  ): Promise<FinishedMovieView> {
    const existing = await prisma.finishedMovie.findFirst({
      where: { id: movieId, projectId },
    });
    if (existing?.status === FinishedMovieStatus.READY && existing.storageKey) {
      return this.toView(existing);
    }

    const render = await this.requireSucceededRender(projectId, renderJobId);
    const owner = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (owner) {
      await this.entitlements.assertOutputDuration(owner.ownerId, render.durationMs, projectId);
    }
    const sourceKey = assertRenderOutputKey(render.outputKey ?? "");
    const source = await this.storage.get(sourceKey);
    if (!source) {
      await this.persistFailed(movieId, projectId, renderJobId, title);
      throw AppError.movieSourceMissing();
    }

    const destKey = assertLibraryStorageKey(libraryStorageKey(projectId, movieId));
    if (destKey === sourceKey) {
      await this.persistFailed(movieId, projectId, renderJobId, title);
      throw AppError.movieOutputInvalid("Library keep must copy into its own storage key.");
    }

    try {
      await this.storage.put({
        key: destKey,
        body: source.body,
        contentType: render.mimeType ?? source.contentType ?? "video/mp4",
      });
    } catch (error) {
      await this.persistFailed(movieId, projectId, renderJobId, title);
      const message = error instanceof Error ? error.message : "Could not copy the film into your library.";
      throw AppError.movieStorageUnavailable(message);
    }

    const exists = await this.storage.exists(destKey);
    if (!exists) {
      await this.persistFailed(movieId, projectId, renderJobId, title);
      throw AppError.movieSourceMissing("The library copy was not stored.");
    }

    const keptAt = new Date();
    const row = existing
      ? await prisma.finishedMovie.update({
          where: { id: movieId },
          data: {
            title,
            status: FinishedMovieStatus.READY,
            storageKey: destKey,
            durationMs: render.durationMs,
            mimeType: render.mimeType ?? "video/mp4",
            byteSize: BigInt(source.body.byteLength),
            checksum: checksumBytes(source.body),
            inputFingerprint: fingerprintLibraryKeep({ renderJobId, outputKey: sourceKey }),
            keptAt,
          },
        })
      : await prisma.finishedMovie.create({
          data: {
            id: movieId,
            projectId,
            renderJobId,
            title,
            status: FinishedMovieStatus.READY,
            storageKey: destKey,
            durationMs: render.durationMs,
            mimeType: render.mimeType ?? "video/mp4",
            byteSize: BigInt(source.body.byteLength),
            checksum: checksumBytes(source.body),
            inputFingerprint: fingerprintLibraryKeep({ renderJobId, outputKey: sourceKey }),
            keptAt,
          },
        });

    logger.info("movie.kept", {
      projectId,
      movieId: row.id,
      renderJobId,
      libraryKey: destKey,
    });
    return this.toView(row);
  }

  private async persistFailed(
    movieId: string,
    projectId: string,
    renderJobId: string,
    title: string,
  ) {
    const existing = await prisma.finishedMovie.findFirst({ where: { id: movieId, projectId } });
    if (existing?.status === FinishedMovieStatus.READY) {
      return;
    }
    if (existing) {
      await prisma.finishedMovie.update({
        where: { id: movieId },
        data: { status: FinishedMovieStatus.FAILED },
      });
      return;
    }
    await prisma.finishedMovie.create({
      data: {
        id: movieId,
        projectId,
        renderJobId,
        title,
        status: FinishedMovieStatus.FAILED,
      },
    });
  }

  private resolveTitle(title: string | undefined, projectTitle: string) {
    const trimmed = title?.trim();
    if (!trimmed) {
      return projectTitle.trim() || "Kept film";
    }
    if (trimmed.length > 120) {
      throw AppError.movieInputInvalid("Give the film a shorter title.");
    }
    return trimmed;
  }

  private async requireMovie(projectId: string, movieId: string) {
    const row = await prisma.finishedMovie.findFirst({
      where: { id: movieId, projectId },
    });
    if (!row) {
      throw AppError.notFound("That film was not found.");
    }
    return row;
  }

  private async findLatestSucceeded(projectId: string) {
    return prisma.renderJob.findFirst({
      where: { projectId, status: RenderJobStatus.SUCCEEDED },
      orderBy: { createdAt: "desc" },
    });
  }

  private async requireLatestSucceeded(projectId: string) {
    const row = await this.findLatestSucceeded(projectId);
    if (!row) {
      throw AppError.movieRenderRequired();
    }
    return this.assertKeepable(row);
  }

  private async requireSucceededRender(projectId: string, renderJobId: string) {
    const row = await prisma.renderJob.findFirst({
      where: { id: renderJobId, projectId },
    });
    if (!row) {
      throw AppError.notFound("That render was not found.");
    }
    return this.assertKeepable(row);
  }

  private assertKeepable(row: {
    id: string;
    status: string;
    outputKey: string | null;
    mimeType: string | null;
    durationMs: number | null;
    byteSize: bigint | null;
  }) {
    if (row.status !== RenderJobStatus.SUCCEEDED) {
      throw AppError.movieRenderRequired("Only a successful render can be kept.");
    }
    if (!row.outputKey) {
      throw AppError.movieOutputInvalid("A successful render must have an opaque storage key.");
    }
    assertRenderOutputKey(row.outputKey);
    return row;
  }

  private async toJobStatus(job: JobRecord): Promise<MovieJobStatusView> {
    const payload = job.payload as LibraryKeepQueuePayload | null;
    const movie = payload?.movieId
      ? await prisma.finishedMovie.findFirst({
          where: { id: payload.movieId, projectId: job.projectId ?? undefined },
        })
      : null;
    return {
      jobId: job.id,
      movieId: movie?.id ?? payload?.movieId ?? null,
      status: job.status,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }
}

export function isMovieKeepAccepted(
  value: FinishedMovieView | MovieKeepAccepted,
): value is MovieKeepAccepted {
  return "jobId" in value && value.status === "ACCEPTED";
}

function createMovieId() {
  return `m_${randomBytes(12).toString("hex")}`;
}
