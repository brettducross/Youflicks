import "server-only";

import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import {
  FinishedMovieStatus,
  JobType,
  PublicationStatus,
} from "@/server/domain/status";
import { assertLibraryStorageKey } from "@/server/movie/opaque-key";
import type { JobQueuePort, JobRecord } from "@/server/ports/jobs";
import type { StoragePort, StorageStream } from "@/server/ports/storage";
import { PublicationAdapterRegistry } from "@/server/adapters/publication/registry";
import {
  assertPublicationInputPrivacy,
  assertPublicationViewPrivacy,
  sanitizePublicationPayload,
} from "@/server/publication/privacy";
import {
  attachmentFilename,
  PublicationDestination,
  SHARE_LINK_DEFAULT_TTL_MS,
  shareWatchPath,
  type PublicationAccepted,
  type PublicationAvailability,
  type PublicationExportInput,
  type PublicationJobStatusView,
  type PublicationShareAccess,
  type PublicationShareLinkInput,
  type PublicationView,
  type ShareLinkCreated,
  type ShareWatchGrant,
} from "@/server/publication/schema";
import { ShareTokenStore } from "@/server/publication/tokens";
import { ProjectService } from "@/server/services/projects";

export type PublishQueuePayload = {
  projectId: string;
  requestedBy: string;
  movieId: string;
  publicationId: string;
  destinationKey: string;
  expiresAt?: string;
};

export type ExportDownloadResult = {
  publication: PublicationView;
  filename: string;
  mimeType: string;
  stream: StorageStream;
};

/**
 * M7 share / export. Owner explicitly publishes a READY FinishedMovie
 * through PublicationPort. Does not keep, bill, or invent AI_PUBLISH jobs.
 * Does not auto-publish on Keep or Watch.
 */
export class PublicationService implements PublicationShareAccess {
  constructor(
    private readonly jobs: JobQueuePort,
    private readonly storage: StoragePort,
    private readonly projects: ProjectService,
    private readonly adapters: PublicationAdapterRegistry,
    private readonly tokens: ShareTokenStore,
    private readonly options: {
      storageReadable?: () => boolean;
      shareTokenConfigured?: () => boolean;
      publicOrigin?: string;
      defaultShareTtlMs?: number;
    } = {},
  ) {}

  async getAvailability(
    userId: string,
    projectId: string,
    movieId: string,
  ): Promise<PublicationAvailability> {
    await this.projects.getForUser(userId, projectId);
    const movie = await this.findMovie(projectId, movieId);
    const movieReady = Boolean(
      movie && movie.status === FinishedMovieStatus.READY && movie.storageKey,
    );
    const storageReadable = this.storageReadable();
    const shareTokenConfigured = this.shareConfigured();
    return {
      canExport:
        movieReady && storageReadable && this.adapters.has(PublicationDestination.DOWNLOAD),
      canShareLink:
        movieReady &&
        shareTokenConfigured &&
        this.adapters.has(PublicationDestination.SHARE_LINK),
      storageReadable,
      shareTokenConfigured,
      movieReady,
    };
  }

  async exportDownload(
    userId: string,
    projectId: string,
    movieId: string,
    body: PublicationExportInput = {},
  ): Promise<ExportDownloadResult | PublicationAccepted> {
    await this.projects.getForUser(userId, projectId);
    assertPublicationInputPrivacy(body);
    const movie = await this.requireReadyMovie(projectId, movieId);
    if (!this.storageReadable() || !this.adapters.has(PublicationDestination.DOWNLOAD)) {
      throw AppError.publicationDestinationUnavailable("Export is not available.");
    }

    const asyncPublish =
      body.async === true || (body.async !== false && this.storage.driver !== "local");
    if (asyncPublish) {
      return this.enqueuePublish(
        userId,
        projectId,
        movie.id,
        PublicationDestination.DOWNLOAD,
      );
    }

    const publication = await this.performPublish({
      projectId,
      movieId: movie.id,
      destinationKey: PublicationDestination.DOWNLOAD,
    });
    const stream = await this.storage.getStream(assertLibraryStorageKey(movie.storageKey ?? ""));
    if (!stream) {
      throw AppError.publicationSourceMissing();
    }
    return {
      publication,
      filename: attachmentFilename(movie.title),
      mimeType: movie.mimeType ?? "video/mp4",
      stream,
    };
  }

  async createShareLink(
    userId: string,
    projectId: string,
    movieId: string,
    body: PublicationShareLinkInput = {},
  ): Promise<ShareLinkCreated | PublicationAccepted> {
    await this.projects.getForUser(userId, projectId);
    assertPublicationInputPrivacy(body);
    const movie = await this.requireReadyMovie(projectId, movieId);
    if (!this.shareConfigured() || !this.adapters.has(PublicationDestination.SHARE_LINK)) {
      throw AppError.publicationDestinationUnavailable("Share links are not available.");
    }

    const expiresAt = this.parseExpiresAt(body.expiresAt);
    const asyncPublish = body.async === true;
    if (asyncPublish) {
      return this.enqueuePublish(
        userId,
        projectId,
        movie.id,
        PublicationDestination.SHARE_LINK,
        expiresAt?.toISOString(),
      );
    }

    return this.performShareLink(movie.id, expiresAt);
  }

  async list(userId: string, projectId: string, movieId: string): Promise<PublicationView[]> {
    await this.projects.getForUser(userId, projectId);
    await this.requireMovie(projectId, movieId);
    const rows = await prisma.publication.findMany({
      where: { movieId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async get(userId: string, projectId: string, publicationId: string): Promise<PublicationView> {
    await this.projects.getForUser(userId, projectId);
    const row = await this.requireOwnedPublication(projectId, publicationId);
    return this.toView(row);
  }

  async revoke(userId: string, projectId: string, publicationId: string): Promise<PublicationView> {
    await this.projects.getForUser(userId, projectId);
    const row = await this.requireOwnedPublication(projectId, publicationId);
    if (row.destinationKey !== PublicationDestination.SHARE_LINK) {
      throw AppError.publicationInputInvalid("Only a share link can be revoked.");
    }
    if (row.status === PublicationStatus.REVOKED) {
      return this.toView(row);
    }
    if (row.status !== PublicationStatus.PUBLISHED) {
      throw AppError.publicationInputInvalid("Only a ready share link can be revoked.");
    }
    const current = sanitizePublicationPayload(row.payload) ?? {};
    const updated = await prisma.publication.update({
      where: { id: row.id },
      data: {
        status: PublicationStatus.REVOKED,
        payload: {
          ...current,
          revokedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    logger.info("publication.revoked", {
      userId,
      projectId,
      publicationId: row.id,
      movieId: row.movieId,
    });
    return this.toView(updated);
  }

  async getJobStatus(
    userId: string,
    projectId: string,
    jobId: string,
  ): Promise<PublicationJobStatusView> {
    await this.projects.getForUser(userId, projectId);
    const job = await this.jobs.get(jobId);
    if (!job || job.projectId !== projectId || job.type !== JobType.PUBLISH) {
      throw AppError.notFound("That share job was not found.");
    }
    return this.toJobStatus(job);
  }

  async processJob(job: JobRecord): Promise<{
    publicationId: string | null;
    shareUrl?: string;
    token?: string;
  }> {
    const payload = job.payload as PublishQueuePayload | null;
    if (
      !payload?.projectId ||
      !payload.requestedBy ||
      !payload.movieId ||
      !payload.publicationId ||
      !payload.destinationKey
    ) {
      throw AppError.jobFailed("Publish job is missing project context.");
    }
    await this.projects.getForUser(payload.requestedBy, payload.projectId);
    if (payload.destinationKey === PublicationDestination.SHARE_LINK) {
      const created = await this.performShareLink(
        payload.movieId,
        payload.expiresAt ? new Date(payload.expiresAt) : undefined,
        payload.publicationId,
      );
      return {
        publicationId: created.publication.id,
        shareUrl: created.shareUrl,
        token: created.token,
      };
    }
    const view = await this.performPublish({
      projectId: payload.projectId,
      movieId: payload.movieId,
      destinationKey: payload.destinationKey,
      publicationId: payload.publicationId,
      expiresAt: payload.expiresAt,
    });
    return { publicationId: view.id };
  }

  async markFailed(jobId: string, message: string) {
    const job = await this.jobs.get(jobId);
    const payload = job?.payload as PublishQueuePayload | null;
    if (!payload?.publicationId || !payload.movieId) {
      return;
    }
    const existing = await prisma.publication.findFirst({
      where: { id: payload.publicationId, movieId: payload.movieId },
    });
    if (existing?.status === PublicationStatus.PUBLISHED) {
      return;
    }
    if (existing) {
      await prisma.publication.update({
        where: { id: existing.id },
        data: { status: PublicationStatus.FAILED },
      });
      return;
    }
    await prisma.publication.create({
      data: {
        id: payload.publicationId,
        movieId: payload.movieId,
        destinationKey: payload.destinationKey,
        status: PublicationStatus.FAILED,
      },
    });
    logger.error("publication.failed", { jobId, publicationId: payload.publicationId, error: message });
  }

  async verifyShareToken(token: string): Promise<ShareWatchGrant> {
    const claims = this.tokens.verify(token);
    const grant = await this.assertShareWatchable(claims.publicationId);
    if (grant.movieId !== claims.movieId) {
      throw AppError.publicationTokenInvalid();
    }
    const row = await prisma.publication.findFirst({ where: { id: claims.publicationId } });
    const payload = sanitizePublicationPayload(row?.payload);
    if (!payload?.tokenFingerprint || payload.tokenFingerprint !== this.tokens.fingerprint(token)) {
      throw AppError.publicationTokenInvalid();
    }
    return grant;
  }

  async assertShareWatchable(publicationId: string): Promise<ShareWatchGrant> {
    const row = await prisma.publication.findFirst({
      where: { id: publicationId },
      include: { movie: true },
    });
    if (!row) {
      throw AppError.publicationTokenInvalid();
    }
    if (row.destinationKey !== PublicationDestination.SHARE_LINK) {
      throw AppError.publicationTokenInvalid();
    }
    if (row.status === PublicationStatus.REVOKED) {
      throw AppError.publicationRevoked();
    }
    if (row.status !== PublicationStatus.PUBLISHED) {
      throw AppError.publicationTokenInvalid();
    }
    const payload = sanitizePublicationPayload(row.payload);
    if (payload?.expiresAt && Date.parse(payload.expiresAt) <= Date.now()) {
      throw AppError.publicationTokenInvalid("That share link has expired.");
    }
    if (row.movie.status !== FinishedMovieStatus.READY || !row.movie.storageKey) {
      throw AppError.publicationMovieRequired("That film is no longer ready to watch.");
    }
    const storageKey = assertLibraryStorageKey(row.movie.storageKey);
    return {
      publicationId: row.id,
      movieId: row.movie.id,
      projectId: row.movie.projectId,
      renderJobId: row.movie.renderJobId,
      storageKey,
      mimeType: row.movie.mimeType ?? "video/mp4",
      durationMs: row.movie.durationMs ?? 0,
      byteSize: row.movie.byteSize !== null ? Number(row.movie.byteSize) : undefined,
      title: row.movie.title,
      expiresAt: payload?.expiresAt ?? new Date(Date.now() + SHARE_LINK_DEFAULT_TTL_MS).toISOString(),
    };
  }

  previewShare(grant: ShareWatchGrant) {
    return {
      title: grant.title,
      durationMs: grant.durationMs,
      expiresAt: grant.expiresAt,
      watchOnly: true,
    };
  }

  toView(row: {
    id: string;
    movieId: string;
    destinationKey: string;
    status: string;
    externalId: string | null;
    payload: unknown;
    publishedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): PublicationView {
    const view: PublicationView = {
      id: row.id,
      movieId: row.movieId,
      destinationKey: row.destinationKey,
      status: row.status,
      externalId: row.externalId,
      payload: sanitizePublicationPayload(row.payload),
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    assertPublicationViewPrivacy(view);
    return view;
  }

  private async enqueuePublish(
    userId: string,
    projectId: string,
    movieId: string,
    destinationKey: string,
    expiresAt?: string,
  ): Promise<PublicationAccepted> {
    const publicationId = createPublicationId();
    await prisma.publication.create({
      data: {
        id: publicationId,
        movieId,
        destinationKey,
        status: PublicationStatus.PENDING,
        payload: expiresAt ? { expiresAt } : undefined,
      },
    });
    const job = await this.jobs.enqueue({
      type: JobType.PUBLISH,
      projectId,
      payload: {
        projectId,
        requestedBy: userId,
        movieId,
        publicationId,
        destinationKey,
        expiresAt,
      } satisfies PublishQueuePayload,
    });
    logger.info("publication.queued", {
      userId,
      projectId,
      jobId: job.id,
      movieId,
      publicationId,
      destinationKey,
    });
    return { jobId: job.id, status: "ACCEPTED" };
  }

  private async performShareLink(
    movieId: string,
    expiresAt?: Date,
    publicationId = createPublicationId(),
  ): Promise<ShareLinkCreated> {
    const issued = this.tokens.issue({ publicationId, movieId, expiresAt });
    const publication = await this.performPublish({
      projectId: "",
      movieId,
      destinationKey: PublicationDestination.SHARE_LINK,
      publicationId,
      expiresAt: new Date(issued.claims.expiresAt).toISOString(),
      extraPayload: { tokenFingerprint: issued.fingerprint },
    });
    const shareUrl = `${this.publicOrigin()}${shareWatchPath(issued.token)}`;
    logger.info("publication.share_link", {
      publicationId: publication.id,
      movieId,
      expiresAt: issued.claims.expiresAt,
    });
    return { publication, shareUrl, token: issued.token };
  }

  private async performPublish(input: {
    projectId: string;
    movieId: string;
    destinationKey: string;
    publicationId?: string;
    expiresAt?: string;
    extraPayload?: Record<string, unknown>;
  }): Promise<PublicationView> {
    if (!this.adapters.has(input.destinationKey)) {
      throw AppError.publicationDestinationUnavailable(
        "That share or export destination is not available.",
        { destinationKey: input.destinationKey },
      );
    }
    const movie = await this.requireReadyMovieById(input.movieId);
    const storageKey = assertLibraryStorageKey(movie.storageKey ?? "");
    const exists = await this.storage.exists(storageKey);
    if (!exists) {
      throw AppError.publicationSourceMissing();
    }

    const publicationId = input.publicationId ?? createPublicationId();
    const existing = await prisma.publication.findFirst({
      where: { id: publicationId, movieId: movie.id },
    });
    if (existing?.status === PublicationStatus.PUBLISHED) {
      return this.toView(existing);
    }

    const pending =
      existing ??
      (await prisma.publication.create({
        data: {
          id: publicationId,
          movieId: movie.id,
          destinationKey: input.destinationKey,
          status: PublicationStatus.PENDING,
        },
      }));

    const adapter = this.adapters.get(input.destinationKey);
    const result = await adapter.publish({
      publicationId: pending.id,
      movieId: movie.id,
      destinationKey: input.destinationKey,
      storageKey,
      mimeType: movie.mimeType ?? "video/mp4",
      title: movie.title,
      options: {
        expiresAt: input.expiresAt,
        contentDisposition:
          input.destinationKey === PublicationDestination.DOWNLOAD ? "attachment" : undefined,
      },
    });

    if (result.status === "FAILED") {
      await prisma.publication.update({
        where: { id: pending.id },
        data: { status: PublicationStatus.FAILED },
      });
      throw AppError.jobFailed(result.error || "Share or export failed.");
    }

    if (result.status === "PENDING") {
      return this.toView(
        await prisma.publication.update({
          where: { id: pending.id },
          data: {
            status: PublicationStatus.PENDING,
            externalId: result.externalId,
            payload: toJson(
              sanitizePublicationPayload({
                ...sanitizePublicationPayload(pending.payload),
                ...result.payload,
                ...input.extraPayload,
                expiresAt: input.expiresAt,
              }),
            ),
          },
        }),
      );
    }

    const publishedAt = new Date();
    const updated = await prisma.publication.update({
      where: { id: pending.id },
      data: {
        status: PublicationStatus.PUBLISHED,
        externalId: result.externalId,
        publishedAt,
        payload: toJson(
          sanitizePublicationPayload({
            ...sanitizePublicationPayload(pending.payload),
            ...result.payload,
            ...input.extraPayload,
            expiresAt: input.expiresAt ?? result.payload?.expiresAt,
          }),
        ),
      },
    });
    logger.info("publication.published", {
      publicationId: updated.id,
      movieId: movie.id,
      destinationKey: input.destinationKey,
    });
    return this.toView(updated);
  }

  private parseExpiresAt(value?: string) {
    if (!value) {
      return undefined;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw AppError.publicationInputInvalid("expiresAt must be an ISO date.");
    }
    this.tokens.resolveExpiry(date);
    return date;
  }

  private async requireReadyMovie(projectId: string, movieId: string) {
    const row = await this.requireMovie(projectId, movieId);
    return this.assertReady(row);
  }

  private async requireReadyMovieById(movieId: string) {
    const row = await prisma.finishedMovie.findFirst({ where: { id: movieId } });
    if (!row) {
      throw AppError.notFound("That film was not found.");
    }
    return this.assertReady(row);
  }

  private async requireMovie(projectId: string, movieId: string) {
    const row = await this.findMovie(projectId, movieId);
    if (!row) {
      throw AppError.notFound("That film was not found.");
    }
    return row;
  }

  private async findMovie(projectId: string, movieId: string) {
    return prisma.finishedMovie.findFirst({
      where: { id: movieId, projectId },
    });
  }

  private assertReady(row: {
    id: string;
    status: string;
    storageKey: string | null;
    title: string;
    mimeType: string | null;
    durationMs: number | null;
    byteSize: bigint | null;
    projectId: string;
    renderJobId: string;
  }) {
    if (row.status !== FinishedMovieStatus.READY) {
      throw AppError.publicationMovieRequired();
    }
    if (!row.storageKey) {
      throw AppError.publicationSourceMissing("A kept film must have an opaque library storage key.");
    }
    assertLibraryStorageKey(row.storageKey);
    return row;
  }

  private async requireOwnedPublication(projectId: string, publicationId: string) {
    const row = await prisma.publication.findFirst({
      where: { id: publicationId },
      include: { movie: true },
    });
    if (!row || row.movie.projectId !== projectId) {
      throw AppError.notFound("That share was not found.");
    }
    return row;
  }

  private async toJobStatus(job: JobRecord): Promise<PublicationJobStatusView> {
    const payload = job.payload as PublishQueuePayload | null;
    const result = (job.result ?? {}) as { publicationId?: string; shareUrl?: string };
    return {
      jobId: job.id,
      publicationId: result.publicationId ?? payload?.publicationId ?? null,
      destinationKey: payload?.destinationKey ?? null,
      status: job.status,
      error: job.error,
      shareUrl: typeof result.shareUrl === "string" ? result.shareUrl : null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  private storageReadable() {
    return this.options.storageReadable?.() ?? true;
  }

  private shareConfigured() {
    return this.options.shareTokenConfigured?.() ?? this.tokens.configured;
  }

  private publicOrigin() {
    return (this.options.publicOrigin ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
  }
}

export function isPublicationAccepted(
  value: ExportDownloadResult | ShareLinkCreated | PublicationAccepted,
): value is PublicationAccepted {
  return "jobId" in value && !("publication" in value) && value.status === "ACCEPTED";
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value as Prisma.InputJsonValue;
}

function createPublicationId() {
  return `pub_${randomBytes(12).toString("hex")}`;
}
