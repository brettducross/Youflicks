import "server-only";

import { AppError } from "@/lib/errors";
import type { AssetCreativeHints, AssetGeneratorInput, PriorGeneratedAssetRef } from "@/server/assets/input";
import {
  inferKindFromRole,
  isGeneratedAssetKind,
  originForKind,
  type GeneratedAssetKind,
} from "@/server/assets/kinds";
import { assertAssetGeneratorInputPrivacy } from "@/server/assets/privacy";
import type { GeneratedAssetDocument } from "@/server/assets/schema";
import { validateGeneratedAssetDocument } from "@/server/assets/validate";
import { prisma } from "@/server/db";
import { GeneratedAssetStatus } from "@/server/domain/status";
import { resolveEffectiveCreativeBrief } from "@/server/personalization/brief";
import type { CreativeIntentView, EffectiveCreativeBrief } from "@/server/personalization/views";
import { IntentService } from "@/server/services/intent";
import { ProjectService } from "@/server/services/projects";
import { TasteService } from "@/server/services/taste";
import type { StoryDocument } from "@/server/story/schema";
import { storyDocumentSchema } from "@/server/story/schema";
import type { TimelineDocument, UnmetMediaRole } from "@/server/timeline/schema";
import { timelineDocumentSchema } from "@/server/timeline/schema";

export type AssetRoleRequest = {
  role: string;
  storySceneId?: string;
  kind?: GeneratedAssetKind;
  reason?: string;
  sourceMediaAssetId?: string;
};

export type ReadyTimelineSource = {
  id: string;
  version: number;
  document: TimelineDocument;
  storyStructureId: string;
  storyStructureVersion: number;
};

/**
 * Assembles AssetGeneratorInput and validates GeneratedAssetDocument.
 * Does not generate, persist, or select a vendor.
 */
export class AssetContractService {
  constructor(
    private readonly projects: ProjectService,
    private readonly taste: TasteService,
    private readonly intent: IntentService,
  ) {}

  async assembleInput(
    userId: string,
    projectId: string,
    timeline: ReadyTimelineSource,
    request: AssetRoleRequest,
    story: StoryDocument | null,
  ): Promise<AssetGeneratorInput> {
    await this.projects.getForUser(userId, projectId);
    const kind = request.kind ?? inferKindFromRole(request.role);
    if (!isGeneratedAssetKind(kind)) {
      throw AppError.assetInputInvalid("Unsupported generated asset kind.", { kind });
    }
    if (kind === "ENHANCEMENT" && !request.sourceMediaAssetId) {
      throw AppError.assetInputInvalid("ENHANCEMENT requires a source MediaAsset.");
    }
    if (request.sourceMediaAssetId) {
      const source = await prisma.mediaAsset.findFirst({
        where: { id: request.sourceMediaAssetId, projectId },
      });
      if (!source) {
        throw AppError.assetInputInvalid("sourceMediaAssetId must be a MediaAsset in this project.");
      }
    }

    const [profile, intent] = await Promise.all([
      this.taste.getForUser(userId, userId),
      this.intent.getForProject(userId, projectId),
    ]);
    const effectiveBrief = resolveEffectiveCreativeBrief(profile, intent);
    const prior = await this.findPriorReady(projectId, timeline.id, request.role, request.storySceneId);

    const input: AssetGeneratorInput = {
      projectId,
      kind,
      role: request.role,
      storySceneId: request.storySceneId,
      reason: request.reason,
      creativeHints: sceneHints(story, request, effectiveBrief),
      projectIntent: intent,
      effectiveBrief,
      sourceMediaAssetId: request.sourceMediaAssetId,
      timelineId: timeline.id,
      timelineVersion: timeline.version,
      storyStructureId: timeline.storyStructureId,
      storyStructureVersion: timeline.storyStructureVersion,
      priorAsset: prior ?? undefined,
    };

    assertAssetGeneratorInputPrivacy(input);
    return input;
  }

  validateDocument(
    input: AssetGeneratorInput,
    raw: unknown,
  ): GeneratedAssetDocument {
    const document = validateGeneratedAssetDocument(raw);
    if (document.kind !== input.kind || document.role !== input.role) {
      throw AppError.assetDocumentInvalid(
        "Generated asset document kind and role must match the generation request.",
        { expected: { kind: input.kind, role: input.role }, received: { kind: document.kind, role: document.role } },
      );
    }
    if (
      document.fulfillment.timelineId !== input.timelineId ||
      document.fulfillment.timelineVersion !== input.timelineVersion
    ) {
      throw AppError.assetDocumentInvalid(
        "Generated asset fulfillment must match the READY Timeline used for generation.",
      );
    }
    if (document.origin !== originForKind(input.kind)) {
      throw AppError.assetDocumentInvalid("Generated asset origin must match kind.");
    }
    if (input.kind === "ENHANCEMENT" && document.sourceMediaAssetId !== input.sourceMediaAssetId) {
      throw AppError.assetDocumentInvalid(
        "ENHANCEMENT document sourceMediaAssetId must match the request.",
      );
    }
    return document;
  }

  private async findPriorReady(
    projectId: string,
    timelineId: string,
    role: string,
    storySceneId?: string,
  ): Promise<PriorGeneratedAssetRef | null> {
    const row = await prisma.generatedAsset.findFirst({
      where: {
        projectId,
        timelineId,
        role,
        status: GeneratedAssetStatus.READY,
        ...(storySceneId ? { storySceneId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (!row || !isGeneratedAssetKind(row.kind)) {
      return null;
    }
    const payload = row.payload as { rationale?: unknown } | null;
    return {
      generatedAssetId: row.id,
      kind: row.kind,
      role: row.role,
      mimeType: row.mimeType,
      rationale: typeof payload?.rationale === "string" ? payload.rationale : undefined,
    };
  }
}

export function parseTimelineDocumentJson(value: unknown): TimelineDocument {
  const parsed = timelineDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw AppError.assetInputInvalid("Stored Timeline is not a valid owned timeline document.");
  }
  return parsed.data;
}

export function parseStoryDocumentJson(value: unknown): StoryDocument | null {
  const parsed = storyDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function resolveUnmetRoles(document: TimelineDocument): UnmetMediaRole[] {
  return document.unmetMediaRoles ?? [];
}

function sceneHints(
  story: StoryDocument | null,
  request: AssetRoleRequest,
  brief: EffectiveCreativeBrief,
): AssetCreativeHints {
  const scene = findScene(story, request.storySceneId);
  const role = scene?.mediaRoles.find((item) => item.role === request.role);
  return {
    scenePurpose: scene?.purpose,
    sceneMood: scene?.mood,
    rolePurpose: role?.purpose,
    briefMood: brief.mood ?? undefined,
    briefVisualStyle: brief.visualStyle ?? undefined,
    briefMusicStyle: brief.musicStyle ?? undefined,
    voiceOverOutline: scene?.voiceOverOutline,
  };
}

function findScene(story: StoryDocument | null, sceneId?: string) {
  if (!story || !sceneId) {
    return undefined;
  }
  for (const act of story.acts) {
    const scene = act.scenes.find((item) => item.id === sceneId);
    if (scene) {
      return scene;
    }
  }
  return undefined;
}

export type { CreativeIntentView };
