import { ANALYSIS_SCHEMA_VERSION, peopleAnalysisSchema } from "@/server/analysis/schema";

/**
 * Fail-closed facts for lock step 1 and step 4.
 * A value stays false unless this module can prove it from the slot's own clips
 * and MediaAsset rows. It does not guess from another role's media.
 */

export type CoverageAsset = {
  id: string;
  kind: string;
  mimeType: string;
  status: string;
  durationMs: number | null;
};

export type CoverageClip = {
  trackKey: string;
  sourceKind?: "MEDIA_ASSET" | "GENERATED_ASSET";
  assetId?: string;
  mediaRole?: string;
  storySceneId?: string;
  timelineStartMs: number;
  timelineEndMs: number;
};

export type SlotCoverage = {
  originalCoversSlot: boolean;
  sourceStillExists: boolean;
  sourceStillId: string | null;
  panX: number;
  panY: number;
  panAnchor: "center" | "face";
};

const CENTER = { panX: 0.5, panY: 0.5, panAnchor: "center" as const };

/**
 * Closed position hints. Free text is not an anchor: an unknown hint stays at the centre.
 * Coordinates are fractions of the frame (x right, y down). No crop and no embedding is stored.
 */
const FACE_ANCHORS: Readonly<Record<string, { x: number; y: number }>> = {
  center: { x: 0.5, y: 0.5 },
  centre: { x: 0.5, y: 0.5 },
  middle: { x: 0.5, y: 0.5 },
  left: { x: 0.25, y: 0.5 },
  right: { x: 0.75, y: 0.5 },
  top: { x: 0.5, y: 0.25 },
  upper: { x: 0.5, y: 0.25 },
  bottom: { x: 0.5, y: 0.75 },
  lower: { x: 0.5, y: 0.75 },
  "upper-left": { x: 0.25, y: 0.25 },
  "top-left": { x: 0.25, y: 0.25 },
  "upper left": { x: 0.25, y: 0.25 },
  "top left": { x: 0.25, y: 0.25 },
  "upper-right": { x: 0.75, y: 0.25 },
  "top-right": { x: 0.75, y: 0.25 },
  "upper right": { x: 0.75, y: 0.25 },
  "top right": { x: 0.75, y: 0.25 },
  "lower-left": { x: 0.25, y: 0.75 },
  "bottom-left": { x: 0.25, y: 0.75 },
  "lower left": { x: 0.25, y: 0.75 },
  "bottom left": { x: 0.25, y: 0.75 },
  "lower-right": { x: 0.75, y: 0.75 },
  "bottom-right": { x: 0.75, y: 0.75 },
  "lower right": { x: 0.75, y: 0.75 },
  "bottom right": { x: 0.75, y: 0.75 },
};

export function deriveSlotCoverage(input: {
  role: string;
  storySceneId?: string | null;
  /**
   * Set only for an ENHANCEMENT role's sourceMediaAssetId.
   * A VIDEO_CLIP id is not proof of a still (fail closed).
   */
  namedStillId: string | null;
  clips: readonly CoverageClip[];
  assets: readonly CoverageAsset[];
}): SlotCoverage {
  const assets = new Map(input.assets.map((asset) => [asset.id, asset]));
  const originalCoversSlot = videoCoversSlot(input, assets);
  const sourceStillId = proveStillId(input, assets);
  return {
    originalCoversSlot,
    sourceStillExists: sourceStillId !== null,
    sourceStillId,
    ...CENTER,
  };
}

export function panAnchorFromAnalysis(payload: unknown): {
  panX: number;
  panY: number;
  panAnchor: "center" | "face";
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return CENTER;
  }
  const root = payload as Record<string, unknown>;
  if (
    Object.hasOwn(root, "analysisSchemaVersion") &&
    root.analysisSchemaVersion !== ANALYSIS_SCHEMA_VERSION
  ) {
    return CENTER;
  }
  const parsed = peopleAnalysisSchema.safeParse(root.people);
  if (!parsed.success || !parsed.data.people) {
    return CENTER;
  }
  for (const person of parsed.data.people) {
    if (person.faceDetected !== true) {
      continue;
    }
    const hint = person.positionHint?.trim().toLowerCase();
    if (!hint) {
      continue;
    }
    const anchor = FACE_ANCHORS[hint];
    if (!anchor) {
      continue;
    }
    return { panX: anchor.x, panY: anchor.y, panAnchor: "face" };
  }
  return CENTER;
}

function videoCoversSlot(
  input: { role: string; storySceneId?: string | null; clips: readonly CoverageClip[] },
  assets: ReadonlyMap<string, CoverageAsset>,
): boolean {
  const clips = slotClips(input).filter((clip) => (clip.sourceKind ?? "MEDIA_ASSET") === "MEDIA_ASSET");
  if (clips.length !== 1) {
    return false;
  }
  const clip = clips[0]!;
  const span = clip.timelineEndMs - clip.timelineStartMs;
  if (!Number.isInteger(span) || span <= 0 || !clip.assetId) {
    return false;
  }
  const asset = assets.get(clip.assetId);
  if (!asset || asset.status !== "READY" || asset.kind !== "VIDEO") {
    return false;
  }
  if (asset.durationMs == null || !Number.isInteger(asset.durationMs) || asset.durationMs < span) {
    return false;
  }
  return true;
}

function proveStillId(
  input: {
    role: string;
    storySceneId?: string | null;
    namedStillId: string | null;
    clips: readonly CoverageClip[];
  },
  assets: ReadonlyMap<string, CoverageAsset>,
): string | null {
  const named = input.namedStillId && isReadyStill(assets.get(input.namedStillId)) ? input.namedStillId : null;
  const clipIds = slotClips(input)
    .filter((clip) => (clip.sourceKind ?? "MEDIA_ASSET") === "MEDIA_ASSET" && clip.assetId)
    .map((clip) => clip.assetId!)
    .filter((id) => isReadyStill(assets.get(id)));
  const uniqueClipIds = [...new Set(clipIds)];
  const fromClip = uniqueClipIds.length === 1 ? uniqueClipIds[0]! : null;
  if (uniqueClipIds.length > 1) {
    return null;
  }
  if (named && fromClip && named !== fromClip) {
    return null;
  }
  return named ?? fromClip;
}

function slotClips(input: {
  role: string;
  storySceneId?: string | null;
  clips: readonly CoverageClip[];
}): CoverageClip[] {
  return input.clips.filter((clip) => {
    if (clip.trackKey !== "video.primary") {
      return false;
    }
    if (clip.mediaRole !== input.role) {
      return false;
    }
    if (input.storySceneId && clip.storySceneId !== input.storySceneId) {
      return false;
    }
    return true;
  });
}

function isReadyStill(asset: CoverageAsset | undefined): asset is CoverageAsset {
  if (!asset || asset.status !== "READY" || asset.kind !== "PHOTO") {
    return false;
  }
  return asset.mimeType.toLowerCase().startsWith("image/");
}
