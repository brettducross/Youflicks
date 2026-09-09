import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import { resolveEffectiveCreativeBrief } from "@/server/personalization/brief";
import { AnalysisService } from "@/server/services/analysis";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { TasteService } from "@/server/services/taste";
import type { StoryDocument } from "@/server/story/schema";
import { storyDocumentSchema } from "@/server/story/schema";
import { fingerprintStoryDocument } from "@/server/timeline/fingerprint";
import { GeneratedAssetStatus } from "@/server/domain/status";
import type {
  TimelineAnalysisSummary,
  TimelineComposerInput,
  TimelineGeneratedInventoryItem,
  TimelineMediaInventoryItem,
} from "@/server/timeline/input";
import { assertTimelineComposerInputPrivacy } from "@/server/timeline/privacy";
import type { TimelineContinuitySubset, TimelineDocument } from "@/server/timeline/schema";
import { timelineDocumentSchema } from "@/server/timeline/schema";
import { validateTimelineDocument } from "@/server/timeline/validate";

export type ReadyStoryStructureSource = {
  id: string;
  version: number;
  document: StoryDocument;
  storyFingerprint: string;
  creativePlanId: string;
  creativePlanVersion: number;
};

/**
 * Assembles TimelineComposerInput and validates TimelineDocument.
 * Does not compose, persist, or select a vendor.
 */
export class TimelineContractService {
  constructor(
    private readonly projects: ProjectService,
    private readonly taste: TasteService,
    private readonly intent: IntentService,
    private readonly media: MediaService,
    private readonly analysis: AnalysisService,
  ) {}

  async assembleInput(
    userId: string,
    projectId: string,
    source: ReadyStoryStructureSource,
    priorTimeline?: TimelineDocument | TimelineContinuitySubset,
  ): Promise<TimelineComposerInput> {
    await this.projects.getForUser(userId, projectId);
    const [profile, intent, assets, understanding] = await Promise.all([
      this.taste.getForUser(userId, userId),
      this.intent.getForProject(userId, projectId),
      this.media.listForProject(userId, projectId),
      this.analysis.listLatestCompletedForProject(userId, projectId),
    ]);

    const effectiveBrief = resolveEffectiveCreativeBrief(profile, intent);
    const summaryByAsset = new Map(
      understanding.map((item) => [item.assetId, minimizeAnalysis(item.analysis)]),
    );

    const generatedRows = await prisma.generatedAsset.findMany({
      where: { projectId, status: GeneratedAssetStatus.READY },
      orderBy: { createdAt: "desc" },
    });

    const input: TimelineComposerInput = {
      projectId,
      story: source.document,
      storyStructureId: source.id,
      storyStructureVersion: source.version,
      storyFingerprint: source.storyFingerprint,
      mediaInventory: assets.map((asset) =>
        toInventoryItem(asset, summaryByAsset.get(asset.id)),
      ),
      generatedInventory: generatedRows.map(toGeneratedInventoryItem),
      projectIntent: intent,
      effectiveBrief,
      priorTimeline,
    };

    assertTimelineComposerInputPrivacy(input);
    return input;
  }

  validateDocument(
    source: ReadyStoryStructureSource,
    inventory: TimelineMediaInventoryItem[],
    raw: unknown,
    generatedInventory: TimelineGeneratedInventoryItem[] = [],
  ): TimelineDocument {
    const document = validateTimelineDocument(raw);
    if (
      document.source.storyStructureId !== source.id ||
      document.source.storyStructureVersion !== source.version
    ) {
      throw AppError.timelineDocumentInvalid(
        "Timeline document source must match the READY StoryStructure used for composition.",
        {
          expected: { storyStructureId: source.id, storyStructureVersion: source.version },
          received: document.source,
        },
      );
    }

    const allowedMediaIds = new Set(inventory.map((item) => item.assetId));
    const allowedGeneratedIds = new Set(
      generatedInventory.map((item) => item.generatedAssetId),
    );
    for (const clip of document.clips) {
      const kind = clip.sourceKind ?? "MEDIA_ASSET";
      if (kind === "MEDIA_ASSET") {
        if (!clip.assetId || !allowedMediaIds.has(clip.assetId)) {
          throw AppError.timelineDocumentInvalid(
            "Every MEDIA_ASSET clip must reference an existing MediaAsset in this project.",
            { clipId: clip.id, assetId: clip.assetId },
          );
        }
      } else if (kind === "GENERATED_ASSET") {
        if (!clip.generatedAssetId || !allowedGeneratedIds.has(clip.generatedAssetId)) {
          throw AppError.timelineDocumentInvalid(
            "Every GENERATED_ASSET clip must reference an existing READY GeneratedAsset in this project.",
            { clipId: clip.id, generatedAssetId: clip.generatedAssetId },
          );
        }
      }
    }

    return {
      ...document,
      source: {
        storyStructureId: source.id,
        storyStructureVersion: source.version,
        storyFingerprint: source.storyFingerprint,
      },
    };
  }
}

export function parseStoryDocumentJson(value: Prisma.JsonValue): StoryDocument {
  const parsed = storyDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw AppError.timelineInputInvalid("Stored StoryStructure is not a valid owned story document.");
  }
  return parsed.data;
}

export function fingerprintStoredStory(value: Prisma.JsonValue): string {
  return fingerprintStoryDocument(parseStoryDocumentJson(value));
}

export function extractPriorTimeline(
  payload: Prisma.JsonValue | null | undefined,
): TimelineDocument | TimelineContinuitySubset | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const full = timelineDocumentSchema.safeParse(payload);
  if (full.success) {
    return full.data;
  }
  const record = payload as Record<string, unknown>;
  const clips = record.clips;
  if (Array.isArray(clips) && clips.length > 0) {
    return {
      title: typeof record.title === "string" ? record.title : undefined,
      clips: clips as TimelineContinuitySubset["clips"],
    };
  }
  return undefined;
}

function toGeneratedInventoryItem(row: {
  id: string;
  kind: string;
  role: string;
  durationMs: number | null;
  storySceneId: string | null;
}): TimelineGeneratedInventoryItem {
  return {
    generatedAssetId: row.id,
    kind: row.kind,
    role: row.role,
    durationMs: row.durationMs,
    storySceneId: row.storySceneId ?? undefined,
  };
}

function toInventoryItem(
  asset: {
    id: string;
    kind: string;
    durationMs: number | null;
    analysisStatus: string;
  },
  analysisSummary?: TimelineAnalysisSummary,
): TimelineMediaInventoryItem {
  return {
    assetId: asset.id,
    kind: asset.kind,
    durationMs: asset.durationMs,
    analysisStatus: asset.analysisStatus,
    analysisSummary,
  };
}

function minimizeAnalysis(analysis: Record<string, unknown> | null): TimelineAnalysisSummary | undefined {
  if (!analysis) {
    return undefined;
  }
  const visual = analysis.visual as Record<string, unknown> | undefined;
  const quality = analysis.quality as Record<string, unknown> | undefined;
  const people = analysis.people as Record<string, unknown> | undefined;
  const summary: TimelineAnalysisSummary = {};
  if (typeof visual?.sceneDescription === "string") {
    summary.sceneDescription = visual.sceneDescription;
  }
  if (Array.isArray(visual?.objects)) {
    summary.objects = visual.objects.filter((item): item is string => typeof item === "string");
  }
  if (Array.isArray(visual?.environments)) {
    summary.environments = visual.environments.filter(
      (item): item is string => typeof item === "string",
    );
  }
  if (typeof people?.count === "number") {
    summary.peopleCount = people.count;
  }
  if (typeof quality?.technicallyUsable === "boolean") {
    summary.technicallyUsable = quality.technicallyUsable;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}
