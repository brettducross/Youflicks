import type { PrismaClient } from "@/generated/prisma/client";
import { creativePlanSchema } from "@/server/director/schema";
import {
  readAnalysisFields,
  slotDurationMsForRole,
  type CueScene,
  type SceneEmphasisCue,
  type ShotCueInput,
} from "@/server/sg/cues";
import type { StoryDocument } from "@/server/story/schema";
import type { TimelineDocument } from "@/server/timeline/schema";

/**
 * Read-only assembly for ShotCueExtractor.
 * Story and Timeline documents are passed in already loaded.
 * This module only reads MediaAnalysis and CreativePlan. It does not write.
 */

export type CueReadDb = Pick<PrismaClient, "mediaAsset" | "mediaAnalysis" | "creativePlan">;

export type CollectShotCueArgs = {
  projectId: string;
  story: StoryDocument | null;
  timeline: TimelineDocument;
  role: string;
  storySceneId?: string | null;
  sourceMediaAssetId?: string | null;
};

export async function collectShotCueInput(
  db: CueReadDb,
  args: CollectShotCueArgs,
): Promise<ShotCueInput> {
  const scene = findCueScene(args.story, args.storySceneId);
  const analysis = await readStartFrame(db, args.projectId, args.sourceMediaAssetId);
  const sceneEmphasis = await readSceneEmphasis(db, args.story);
  return {
    scene,
    unmetRole: {
      role: args.role,
      storySceneId: args.storySceneId ?? undefined,
    },
    slotDurationMs: slotDurationMsForRole(args.timeline.clips, args.role, args.storySceneId),
    analysis,
    sceneEmphasis,
  };
}

export function findCueScene(story: StoryDocument | null, sceneId?: string | null): CueScene | null {
  if (!story || !sceneId) {
    return null;
  }
  for (const act of story.acts) {
    const scene = act.scenes.find((item) => item.id === sceneId);
    if (!scene) {
      continue;
    }
    return {
      id: scene.id,
      dramaticFunction: scene.dramaticFunction,
      purpose: scene.purpose,
      dialogueOutline: scene.dialogueOutline,
      mediaRoles: scene.mediaRoles.map((item) => ({
        role: item.role,
        purpose: item.purpose,
      })),
    };
  }
  return null;
}

async function readStartFrame(
  db: CueReadDb,
  projectId: string,
  sourceMediaAssetId?: string | null,
) {
  if (!sourceMediaAssetId) {
    return null;
  }
  const asset = await db.mediaAsset.findFirst({
    where: { id: sourceMediaAssetId, projectId },
    select: { id: true, analysisStatus: true },
  });
  if (!asset) {
    return null;
  }
  const row = await db.mediaAnalysis.findFirst({
    where: { assetId: asset.id },
    orderBy: { createdAt: "desc" },
    select: { status: true, payload: true },
  });
  if (!row) {
    return readAnalysisFields(asset.analysisStatus, null);
  }
  return readAnalysisFields(row.status, row.payload);
}

async function readSceneEmphasis(
  db: CueReadDb,
  story: StoryDocument | null,
): Promise<SceneEmphasisCue[]> {
  const planId = story?.source.creativePlanId;
  if (!planId) {
    return [];
  }
  const row = await db.creativePlan.findUnique({
    where: { id: planId },
    select: { plan: true },
  });
  if (!row) {
    return [];
  }
  const parsed = creativePlanSchema.safeParse(row.plan);
  if (!parsed.success || !parsed.data.decisions) {
    return [];
  }
  const emphasis: SceneEmphasisCue[] = [];
  for (const decision of parsed.data.decisions) {
    if (decision.kind !== "scene_emphasis") {
      continue;
    }
    emphasis.push({
      kind: decision.kind,
      subject: decision.subject,
      detail: copyIdDetail(decision.detail),
    });
  }
  return emphasis;
}

/** Keep only the id fields a scene_emphasis decision may use to name a scene. */
function copyIdDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!detail) {
    return undefined;
  }
  const copied: Record<string, unknown> = {};
  if (typeof detail.storySceneId === "string") {
    copied.storySceneId = detail.storySceneId;
  }
  if (typeof detail.sceneId === "string") {
    copied.sceneId = detail.sceneId;
  }
  if (Array.isArray(detail.storySceneIds)) {
    copied.storySceneIds = detail.storySceneIds.filter((item) => typeof item === "string");
  }
  if (Array.isArray(detail.sceneIds)) {
    copied.sceneIds = detail.sceneIds.filter((item) => typeof item === "string");
  }
  return copied;
}
