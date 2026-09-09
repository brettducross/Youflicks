import "server-only";

import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import { GeneratedAssetStatus, TimelineStatus } from "@/server/domain/status";
import { assertRenderComposerInputPrivacy } from "@/server/render/privacy";
import type { RenderComposerInput } from "@/server/render/input";
import {
  DEFAULT_RENDER_OUTPUT_PROFILE,
  RENDER_MANIFEST_SCHEMA_VERSION,
  RENDER_OUTPUT_PROFILES,
  type RenderManifest,
  type RenderOutputProfile,
  type RenderResultDocument,
} from "@/server/render/schema";
import { validateRenderManifest, validateRenderResultDocument } from "@/server/render/validate";
import type { StoragePort } from "@/server/ports/storage";
import { ProjectService } from "@/server/services/projects";
import type { TimelineDocument } from "@/server/timeline/schema";
import { timelineDocumentSchema } from "@/server/timeline/schema";

export type ReadyTimelineForRender = {
  id: string;
  version: number;
  document: TimelineDocument;
};

/**
 * Assembles RenderManifest from a READY Timeline and validates render results.
 * Does not render, persist RenderJob success, or select a vendor.
 */
export class RenderContractService {
  constructor(
    private readonly projects: ProjectService,
    private readonly storage: StoragePort,
  ) {}

  parseOutputProfile(value?: string | null): RenderOutputProfile {
    if (!value) {
      return DEFAULT_RENDER_OUTPUT_PROFILE;
    }
    if ((RENDER_OUTPUT_PROFILES as readonly string[]).includes(value)) {
      return value as RenderOutputProfile;
    }
    throw AppError.renderInputInvalid("Unsupported render output profile.", { outputProfile: value });
  }

  async assembleManifest(
    userId: string,
    projectId: string,
    outputProfile: RenderOutputProfile = DEFAULT_RENDER_OUTPUT_PROFILE,
  ): Promise<{ timeline: ReadyTimelineForRender; manifest: RenderManifest }> {
    await this.projects.getForUser(userId, projectId);
    const timeline = await this.requireReadyTimeline(projectId);
    if (timeline.document.clips.length === 0) {
      throw AppError.renderInputInvalid("This cut has no shots to render.");
    }

    const clips: RenderManifest["clips"] = [];
    for (const clip of timeline.document.clips) {
      const sourceKind = clip.sourceKind ?? "MEDIA_ASSET";
      const resolved = await this.resolveClipSource(projectId, clip, sourceKind);
      clips.push({
        clipId: clip.id,
        trackKey: clip.trackKey,
        sourceKind,
        sourceId: resolved.sourceId,
        storageKey: resolved.storageKey,
        timelineStartMs: clip.timelineStartMs,
        timelineEndMs: clip.timelineEndMs,
        sourceInMs: clip.sourceInMs,
        sourceOutMs: clip.sourceOutMs,
        transitionFromPrevious: clip.transitionFromPrevious,
        captionText: clip.captionText,
      });
    }

    const manifest = validateRenderManifest({
      schemaVersion: RENDER_MANIFEST_SCHEMA_VERSION,
      timelineId: timeline.id,
      timelineVersion: timeline.version,
      totalDurationMs: timeline.document.totalDurationMs,
      outputProfile,
      clips,
      rationale:
        (timeline.document.unmetMediaRoles?.length ?? 0) > 0
          ? "Rendering the current READY cut as-is. Some story roles remain unfilled."
          : undefined,
    });

    return { timeline, manifest };
  }

  composeInput(input: {
    projectId: string;
    timeline: ReadyTimelineForRender;
    manifest: RenderManifest;
    destinationKeyHint: string;
  }): RenderComposerInput {
    const composerInput: RenderComposerInput = {
      projectId: input.projectId,
      timelineId: input.timeline.id,
      timelineVersion: input.timeline.version,
      manifest: input.manifest,
      outputProfile: input.manifest.outputProfile,
      destinationKeyHint: input.destinationKeyHint,
    };
    assertRenderComposerInputPrivacy(composerInput);
    return composerInput;
  }

  validateResult(raw: unknown): RenderResultDocument {
    return validateRenderResultDocument(raw);
  }

  private async requireReadyTimeline(projectId: string): Promise<ReadyTimelineForRender> {
    const row = await prisma.timeline.findFirst({
      where: { projectId, status: TimelineStatus.READY },
      orderBy: { version: "desc" },
    });
    if (!row || !row.payload) {
      throw AppError.renderTimelineRequired();
    }
    const parsed = timelineDocumentSchema.safeParse(row.payload);
    if (!parsed.success) {
      throw AppError.renderInputInvalid("Stored Timeline is not a valid owned timeline document.");
    }
    return { id: row.id, version: row.version, document: parsed.data };
  }

  private async resolveClipSource(
    projectId: string,
    clip: TimelineDocument["clips"][number],
    sourceKind: "MEDIA_ASSET" | "GENERATED_ASSET",
  ): Promise<{ sourceId: string; storageKey: string }> {
    if (sourceKind === "MEDIA_ASSET") {
      if (!clip.assetId) {
        throw AppError.renderSourceUnresolved("A MEDIA_ASSET clip is missing its footage id.", {
          clipId: clip.id,
        });
      }
      const asset = await prisma.mediaAsset.findFirst({
        where: { id: clip.assetId, projectId },
      });
      if (!asset || asset.status !== "READY" || !asset.storageKey) {
        throw AppError.renderSourceUnresolved(
          "A cut shot is missing READY footage bytes.",
          { clipId: clip.id, sourceKind, sourceId: clip.assetId },
        );
      }
      await this.assertStoredBytes(asset.storageKey, clip.id, sourceKind, asset.id);
      return { sourceId: asset.id, storageKey: asset.storageKey };
    }

    if (!clip.generatedAssetId) {
      throw AppError.renderSourceUnresolved("A GENERATED_ASSET clip is missing its piece id.", {
        clipId: clip.id,
      });
    }
    const generated = await prisma.generatedAsset.findFirst({
      where: { id: clip.generatedAssetId, projectId },
    });
    if (
      !generated ||
      generated.status !== GeneratedAssetStatus.READY ||
      !generated.storageKey
    ) {
      throw AppError.renderSourceUnresolved(
        "A cut shot is missing a READY generated piece.",
        { clipId: clip.id, sourceKind, sourceId: clip.generatedAssetId },
      );
    }
    await this.assertStoredBytes(generated.storageKey, clip.id, sourceKind, generated.id);
    return { sourceId: generated.id, storageKey: generated.storageKey };
  }

  private async assertStoredBytes(
    storageKey: string,
    clipId: string,
    sourceKind: string,
    sourceId: string,
  ) {
    const exists = await this.storage.exists(storageKey);
    if (!exists) {
      throw AppError.renderSourceUnresolved("A clip source could not be read from storage.", {
        clipId,
        sourceKind,
        sourceId,
      });
    }
  }
}
