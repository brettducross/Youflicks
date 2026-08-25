import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { MediaAnalysisView } from "@/lib/media-types";
import { prisma } from "@/server/db";
import { ANALYSIS_SCHEMA_VERSION, type MediaAnalysisDocument } from "@/server/analysis/schema";
import { capabilityForKind } from "@/server/analysis/required-capability";
import { AnalysisStatus, JobType, ProjectStatus } from "@/server/domain/status";
import type { JobQueuePort, JobRecord } from "@/server/ports/jobs";
import type { MediaAnalyzerPort } from "@/server/ports/media-analyzer";
import { AttributionService } from "@/server/services/attribution";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";

type AnalysisJobPayload = {
  assetId: string;
  projectId: string;
  requestedBy: string;
};

export class AnalysisService {
  constructor(
    private readonly media: MediaService,
    private readonly jobs: JobQueuePort,
    private readonly analyzer: MediaAnalyzerPort,
    private readonly projects: ProjectService = new ProjectService(),
    private readonly attribution: AttributionService = new AttributionService(),
  ) {}

  toView(row: {
    id: string;
    assetId: string;
    status: string;
    schemaVersion: string;
    providerKey: string;
    modelId: string | null;
    modelVersion: string | null;
    payload: Prisma.JsonValue;
    error: string | null;
    analyzedAt: Date | null;
    createdAt: Date;
  }): MediaAnalysisView {
    return {
      id: row.id,
      assetId: row.assetId,
      status: row.status,
      schemaVersion: row.schemaVersion,
      providerKey: row.providerKey,
      modelId: row.modelId,
      modelVersion: row.modelVersion,
      analyzedAt: row.analyzedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      error: row.error,
      analysis: (row.payload as MediaAnalysisDocument | null) ?? null,
    };
  }

  async requestAnalysis(userId: string, projectId: string, assetId: string) {
    const asset = await this.media.getOwnedAsset(userId, projectId, assetId);
    capabilityForKind(asset.kind);

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { analysisStatus: AnalysisStatus.QUEUED },
    });

    const job = await this.jobs.enqueue({
      type: JobType.MEDIA_ANALYZE,
      projectId,
      payload: {
        assetId: asset.id,
        projectId,
        requestedBy: userId,
      } satisfies AnalysisJobPayload,
    });

    if (asset.projectId) {
      await prisma.project.updateMany({
        where: {
          id: projectId,
          status: { in: [ProjectStatus.DRAFT, ProjectStatus.INGESTING] },
        },
        data: { status: ProjectStatus.ANALYZING },
      });
    }

    logger.info("analysis.requested", { userId, projectId, assetId });
    logger.info("analysis.queued", { userId, projectId, assetId, jobId: job.id });
    return { jobId: job.id, analysisStatus: AnalysisStatus.QUEUED };
  }

  async listLatestCompletedForProject(userId: string, projectId: string) {
    await this.projects.getForUser(userId, projectId);
    const assets = await prisma.mediaAsset.findMany({
      where: { projectId },
      select: { id: true, kind: true },
    });
    const rows = await prisma.mediaAnalysis.findMany({
      where: {
        assetId: { in: assets.map((asset) => asset.id) },
        status: AnalysisStatus.COMPLETED,
      },
      orderBy: { createdAt: "desc" },
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.assetId)) {
        latest.set(row.assetId, row);
      }
    }
    const kindByAsset = new Map(assets.map((asset) => [asset.id, asset.kind]));
    return [...latest.values()].map((row) => ({
      assetId: row.assetId,
      kind: kindByAsset.get(row.assetId) ?? "OTHER",
      analysis: this.toView(row).analysis,
    }));
  }

  async listForAsset(userId: string, projectId: string, assetId: string) {
    await this.media.getOwnedAsset(userId, projectId, assetId);
    const rows = await prisma.mediaAnalysis.findMany({
      where: { assetId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async getForAsset(userId: string, projectId: string, assetId: string, analysisId: string) {
    await this.media.getOwnedAsset(userId, projectId, assetId);
    const row = await prisma.mediaAnalysis.findFirst({
      where: { id: analysisId, assetId },
    });
    if (!row) {
      throw AppError.notFound("That analysis is not in this project.");
    }
    return this.toView(row);
  }

  async processJob(job: JobRecord) {
    const payload = job.payload as AnalysisJobPayload | null;
    if (!payload?.assetId || !payload.projectId) {
      throw AppError.jobFailed("Analysis job is missing asset context.");
    }

    const asset = await prisma.mediaAsset.findFirst({
      where: { id: payload.assetId, projectId: payload.projectId },
    });
    if (!asset) {
      throw AppError.notFound("That clip is not in this project.");
    }

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { analysisStatus: AnalysisStatus.PROCESSING },
    });

    const capability = capabilityForKind(asset.kind);
    const startedAt = Date.now();
    logger.info("analysis.started", {
      assetId: asset.id,
      projectId: asset.projectId,
      jobId: job.id,
      capability,
    });
    const result = await this.analyzer.analyze({
      assetId: asset.id,
      projectId: asset.projectId,
      storageKey: asset.storageKey,
      kind: asset.kind,
      mimeType: asset.mimeType,
      filename: asset.filename,
      byteSize: Number(asset.byteSize),
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      checksum: asset.checksum,
      previewStorageKey: asset.previewKey,
      requestedCapabilities: [capability],
    });

    const analysis = { ...result.analysis };
    if (asset.checksum) {
      const siblings = await prisma.mediaAsset.findMany({
        where: {
          projectId: asset.projectId,
          checksum: asset.checksum,
          id: { not: asset.id },
        },
        select: { id: true },
      });
      if (siblings.length > 0) {
        analysis.duplicates = {
          exact: true,
          groupId: `checksum:${asset.checksum}`,
          similarAssetIds: siblings.map((row) => row.id),
          confidence: 1,
        };
      }
    }

    const row = await prisma.mediaAnalysis.create({
      data: {
        assetId: asset.id,
        providerKey: result.provenance.providerKey,
        modelId: result.provenance.modelId,
        modelVersion: result.provenance.modelVersion,
        schemaVersion: analysis.analysisSchemaVersion ?? ANALYSIS_SCHEMA_VERSION,
        status: AnalysisStatus.COMPLETED,
        payload: analysis as Prisma.InputJsonValue,
        analyzedAt: new Date(),
      },
    });

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { analysisStatus: AnalysisStatus.COMPLETED },
    });

    await this.attribution.record({
      projectId: asset.projectId,
      assetId: asset.id,
      analysisId: row.id,
      jobId: job.id,
      providerKey: result.provenance.providerKey,
      capability,
      modelId: result.provenance.modelId,
      modelVersion: result.provenance.modelVersion,
    });

    logger.info("analysis.completed", {
      assetId: asset.id,
      projectId: asset.projectId,
      analysisId: row.id,
      providerKey: result.provenance.providerKey,
      capability,
      durationMs: Date.now() - startedAt,
      status: AnalysisStatus.COMPLETED,
    });

    return this.toView(row);
  }

  async markAssetFailed(assetId: string, message: string) {
    await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { analysisStatus: AnalysisStatus.FAILED },
    });
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) {
      return;
    }
    await prisma.mediaAnalysis.create({
      data: {
        assetId,
        providerKey: "none",
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        status: AnalysisStatus.FAILED,
        error: message,
      },
    });
  }
}
