import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { MediaAssetView } from "@/lib/media-types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import { MediaStatus } from "@/server/media/constants";
import { probeAndPreview } from "@/server/media/preview";
import {
  defaultMediaLimits,
  sanitizeFilename,
  sniffMedia,
  validateByteSize,
  type MediaLimitConfig,
} from "@/server/media/sniff";
import { ProjectStatus } from "@/server/domain/status";
import type { StoragePort } from "@/server/ports/storage";
import { ProjectService } from "@/server/services/projects";

type MediaAssetRow = {
  id: string;
  filename: string;
  kind: string;
  mimeType: string;
  byteSize: bigint;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  status: string;
  createdAt: Date;
  previewKey: string | null;
};

export class MediaService {
  constructor(
    private readonly storage: StoragePort,
    private readonly projects: ProjectService = new ProjectService(),
    private readonly limits: MediaLimitConfig = defaultMediaLimits,
  ) {}

  toView(projectId: string, asset: MediaAssetRow): MediaAssetView {
    return {
      id: asset.id,
      filename: asset.filename,
      kind: asset.kind,
      mimeType: asset.mimeType,
      byteSize: Number(asset.byteSize),
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      status: asset.status,
      createdAt: asset.createdAt.toISOString(),
      previewUrl: asset.previewKey
        ? `/api/projects/${projectId}/assets/${asset.id}/file?variant=preview`
        : null,
      originalUrl: `/api/projects/${projectId}/assets/${asset.id}/file?variant=original`,
    };
  }

  async listForProject(userId: string, projectId: string) {
    await this.projects.getForUser(userId, projectId);
    const assets = await prisma.mediaAsset.findMany({
      where: { projectId, status: { not: MediaStatus.ARCHIVED } },
      orderBy: { createdAt: "desc" },
    });
    return assets.map((asset) => this.toView(projectId, asset));
  }

  async ingest(
    userId: string,
    projectId: string,
    input: { filename: string; bytes: Uint8Array },
  ) {
    const project = await this.projects.getForUser(userId, projectId);
    const filename = sanitizeFilename(input.filename);
    if (!Number.isFinite(input.bytes.byteLength) || input.bytes.byteLength <= 0) {
      throw AppError.validation("That file is empty.");
    }
    const hardMax = Math.max(this.limits.maxImageBytes, this.limits.maxVideoBytes);
    if (input.bytes.byteLength > hardMax) {
      const mb = Math.round(hardMax / (1024 * 1024));
      throw AppError.validation(`Files must be ${mb} MB or smaller.`);
    }
    const sniffed = await sniffMedia(input.bytes);
    validateByteSize(input.bytes.byteLength, sniffed.kind, this.limits);

    const assetId = randomUUID();
    const originalKey = `projects/${projectId}/assets/${assetId}/original${sniffed.extension}`;
    const previewKey = `projects/${projectId}/assets/${assetId}/preview.jpg`;
    const storedKeys: string[] = [];
    const checksum = createHash("sha256").update(input.bytes).digest("hex");

    try {
      await this.storage.put({
        key: originalKey,
        body: input.bytes,
        contentType: sniffed.mimeType,
      });
      storedKeys.push(originalKey);

      const probe = await probeAndPreview({
        bytes: input.bytes,
        kind: sniffed.kind,
        extension: sniffed.extension,
      });

      let storedPreviewKey: string | null = null;
      if (probe.previewJpeg && probe.previewJpeg.byteLength > 0) {
        await this.storage.put({
          key: previewKey,
          body: probe.previewJpeg,
          contentType: "image/jpeg",
        });
        storedKeys.push(previewKey);
        storedPreviewKey = previewKey;
      }

      const asset = await prisma.mediaAsset.create({
        data: {
          id: assetId,
          projectId: project.id,
          kind: sniffed.kind,
          filename,
          mimeType: sniffed.mimeType,
          byteSize: BigInt(input.bytes.byteLength),
          storageKey: originalKey,
          previewKey: storedPreviewKey,
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
          status: MediaStatus.READY,
          checksum,
        },
      });

      if (project.status === ProjectStatus.DRAFT) {
        await prisma.project.update({
          where: { id: project.id },
          data: { status: ProjectStatus.INGESTING },
        });
      }

      logger.info("media.ingest", {
        userId,
        projectId,
        assetId,
        mimeType: sniffed.mimeType,
        bytes: input.bytes.byteLength,
      });

      return this.toView(projectId, asset);
    } catch (error) {
      await Promise.all(storedKeys.map((key) => this.storage.delete(key).catch(() => undefined)));
      logger.error("media.ingest_failed", {
        userId,
        projectId,
        filename,
        error: error instanceof Error ? error.message : "unknown",
      });
      throw error;
    }
  }

  async getOwnedAsset(userId: string, projectId: string, assetId: string) {
    await this.projects.getForUser(userId, projectId);
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: assetId, projectId },
    });
    if (!asset || asset.status === MediaStatus.ARCHIVED) {
      throw AppError.notFound("That clip is not in this project.");
    }
    return asset;
  }

  async remove(userId: string, projectId: string, assetId: string) {
    const asset = await this.getOwnedAsset(userId, projectId, assetId);
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
    await this.storage.delete(asset.storageKey).catch(() => undefined);
    if (asset.previewKey) {
      await this.storage.delete(asset.previewKey).catch(() => undefined);
    }

    const remaining = await prisma.mediaAsset.count({ where: { projectId } });
    if (remaining === 0) {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.DRAFT },
      });
    }

    logger.info("media.remove", { userId, projectId, assetId });
  }

  async openFile(
    userId: string,
    projectId: string,
    assetId: string,
    variant: "original" | "preview",
    range?: { start: number; end: number },
  ) {
    const asset = await this.getOwnedAsset(userId, projectId, assetId);
    if (variant === "preview") {
      if (!asset.previewKey) {
        throw AppError.notFound("No preview exists for that asset.");
      }
      const stream = await this.storage.getStream(asset.previewKey, range);
      if (!stream) {
        throw AppError.notFound("The preview is missing from storage.");
      }
      return {
        filename: `${asset.filename.replace(/\.[^.]+$/, "") || "preview"}.jpg`,
        mimeType: "image/jpeg",
        stream,
      };
    }

    const stream = await this.storage.getStream(asset.storageKey, range);
    if (!stream) {
      throw AppError.notFound("The original file is missing from storage.");
    }
    return {
      filename: asset.filename,
      mimeType: asset.mimeType,
      stream,
    };
  }
}
