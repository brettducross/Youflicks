import type { PrismaClient } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { CREATIVE_PLAN_SCHEMA_VERSION, directorDecisionSchema } from "@/server/director/schema";
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
  /**
   * When set, the plan is not read again. processJob loads this once per job.
   * An empty array is a real preload (no scene_emphasis), not a missing read.
   */
  sceneEmphasis?: readonly SceneEmphasisCue[];
};

export async function collectShotCueInput(
  db: CueReadDb,
  args: CollectShotCueArgs,
): Promise<ShotCueInput> {
  const scene = findCueScene(args.story, args.storySceneId);
  const analysis = await readStartFrame(db, args.projectId, args.sourceMediaAssetId);
  const sceneEmphasis =
    args.sceneEmphasis ?? (await loadSceneEmphasis(db, args.projectId, args.story));
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
  const rows = await db.mediaAnalysis.findMany({
    where: { assetId: asset.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 2,
    select: { id: true, status: true, payload: true, createdAt: true },
  });
  const latest = rows[0];
  if (!latest) {
    return readAnalysisFields(asset.analysisStatus, null, asset.analysisStatus);
  }
  const previous = rows[1];
  if (previous && latest.createdAt.getTime() === previous.createdAt.getTime()) {
    return readAnalysisFields(null, null, asset.analysisStatus);
  }
  return readAnalysisFields(latest.status, latest.payload, asset.analysisStatus);
}

/**
 * Director scene_emphasis for this project only.
 * An unknown or missing plan schemaVersion drops every emphasis.
 * Inside a 1.0 plan, one invalid decision is skipped.
 */
export async function loadSceneEmphasis(
  db: CueReadDb,
  projectId: string,
  story: StoryDocument | null,
): Promise<SceneEmphasisCue[]> {
  const planId = story?.source.creativePlanId;
  if (!planId) {
    return [];
  }
  const row = await db.creativePlan.findFirst({
    where: { id: planId, projectId },
    select: { plan: true },
  });
  if (!row) {
    return [];
  }
  return emphasisFromPlan(row.plan, planId);
}

function emphasisFromPlan(plan: unknown, planId: string): SceneEmphasisCue[] {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return [];
  }
  const version = (plan as { schemaVersion?: unknown }).schemaVersion;
  if (version !== CREATIVE_PLAN_SCHEMA_VERSION) {
    logger.warn("cue.plan_version_dropped", {
      planId,
      schemaVersion: version === undefined || version === null ? "missing" : String(version),
    });
    return [];
  }
  const decisions = (plan as { decisions?: unknown }).decisions;
  if (!Array.isArray(decisions)) {
    return [];
  }
  const emphasis: SceneEmphasisCue[] = [];
  for (const item of decisions) {
    const parsed = directorDecisionSchema.safeParse(item);
    if (!parsed.success || parsed.data.kind !== "scene_emphasis") {
      continue;
    }
    emphasis.push({
      kind: parsed.data.kind,
      subject: parsed.data.subject,
      detail: copyIdDetail(parsed.data.detail),
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
