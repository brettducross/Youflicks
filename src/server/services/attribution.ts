import "server-only";

import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import type { ProviderAttributionView } from "@/server/personalization/views";
import { ProjectService } from "@/server/services/projects";

export type RecordAttributionInput = {
  projectId: string;
  assetId?: string | null;
  generatedAssetId?: string | null;
  analysisId?: string | null;
  jobId?: string | null;
  providerKey: string;
  capability: string;
  modelId?: string | null;
  modelVersion?: string | null;
};

export class AttributionService {
  constructor(private readonly projects: ProjectService = new ProjectService()) {}

  toView(row: {
    id: string;
    projectId: string;
    assetId: string | null;
    generatedAssetId: string | null;
    analysisId: string | null;
    jobId: string | null;
    providerKey: string;
    capability: string;
    modelId: string | null;
    modelVersion: string | null;
    recordedAt: Date;
  }): ProviderAttributionView {
    return {
      id: row.id,
      projectId: row.projectId,
      assetId: row.assetId,
      generatedAssetId: row.generatedAssetId,
      analysisId: row.analysisId,
      jobId: row.jobId,
      providerKey: row.providerKey,
      capability: row.capability,
      modelId: row.modelId,
      modelVersion: row.modelVersion,
      recordedAt: row.recordedAt.toISOString(),
    };
  }

  async record(input: RecordAttributionInput) {
    const row = await prisma.providerAttribution.create({
      data: {
        projectId: input.projectId,
        assetId: input.assetId ?? null,
        generatedAssetId: input.generatedAssetId ?? null,
        analysisId: input.analysisId ?? null,
        jobId: input.jobId ?? null,
        providerKey: input.providerKey,
        capability: input.capability,
        modelId: input.modelId ?? null,
        modelVersion: input.modelVersion ?? null,
      },
    });
    logger.info("attribution.recorded", {
      projectId: input.projectId,
      assetId: input.assetId,
      providerKey: input.providerKey,
      capability: input.capability,
    });
    return this.toView(row);
  }

  async listForProject(userId: string, projectId: string) {
    await this.projects.getForUser(userId, projectId);
    const rows = await prisma.providerAttribution.findMany({
      where: { projectId },
      orderBy: { recordedAt: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }
}
