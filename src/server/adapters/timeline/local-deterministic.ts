import type { TimelineExecutionAttribution } from "@/server/adapters/timeline/attribution";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import { TimelineCapability } from "@/server/ports/capabilities";
import type { TimelineComposerInput, TimelineMediaInventoryItem } from "@/server/timeline/input";
import {
  DEFAULT_TIMELINE_TRACKS,
  TIMELINE_DOCUMENT_SCHEMA_VERSION,
  type TimelineClipDocument,
  type TimelineDocument,
  type UnmetMediaRole,
} from "@/server/timeline/schema";

const STILL_DURATION_MS = 3_000;
const FALLBACK_CLIP_MS = 4_000;

/**
 * Deterministic timeline composer for tests and explicit local development.
 * Not production AI. Must never advertise production timeline availability.
 * Places only existing MediaAsset ids. Unmet story roles go to unmetMediaRoles.
 * Attribution is adapter metadata — not part of TimelineComposerPort.composeTimeline.
 */
export class LocalDeterministicTimelineComposer implements TimelineComposerPort {
  readonly providerKey = "youflicks.local.timeline";
  readonly production = false as const;
  readonly modelId = "deterministic-timeline-v1";
  readonly modelVersion = "1.0";

  executionAttribution(): TimelineExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability: TimelineCapability.TIMELINE_COMPOSITION,
      modelId: this.modelId,
      modelVersion: this.modelVersion,
    };
  }

  async composeTimeline(input: TimelineComposerInput): Promise<TimelineDocument> {
    const inventoryById = new Map(input.mediaInventory.map((item) => [item.assetId, item]));
    const roles = collectMediaRoles(input.story);
    const priorChoices = priorClipChoices(input.priorTimeline);
    const usedAssets = new Set<string>();
    const clips: TimelineClipDocument[] = [];
    const unmet: UnmetMediaRole[] = [];
    let cursorMs = 0;
    let clipIndex = 0;

    for (const choice of priorChoices) {
      const asset = inventoryById.get(choice.assetId);
      if (!asset || usedAssets.has(asset.assetId)) {
        continue;
      }
      const duration = clipDurationMs(asset);
      clips.push({
        id: `clip-${clipIndex + 1}`,
        trackKey: choice.trackKey === "audio.voice" || choice.trackKey === "audio.music" || choice.trackKey === "caption.main"
          ? choice.trackKey
          : "video.primary",
        order: clipIndex,
        assetId: asset.assetId,
        storySceneId: choice.storySceneId,
        mediaRole: choice.mediaRole,
        timelineStartMs: cursorMs,
        timelineEndMs: cursorMs + duration,
        sourceInMs: 0,
        sourceOutMs: durationForSource(asset, duration),
        transitionFromPrevious: clipIndex === 0 ? "CUT" : "CUT",
      });
      usedAssets.add(asset.assetId);
      cursorMs += duration;
      clipIndex += 1;
    }

    const remainingRoles = roles.filter((role) => {
      return !clips.some(
        (clip) => clip.mediaRole === role.role && clip.storySceneId === role.storySceneId,
      );
    });

    for (const role of remainingRoles) {
      const asset = pickAssetForRole(input.mediaInventory, usedAssets, role.role);
      if (!asset) {
        unmet.push({
          role: role.role,
          storySceneId: role.storySceneId,
          reason: "No unused MediaAsset available for this story role.",
        });
        continue;
      }
      const duration = clipDurationMs(asset);
      const trackKey = asset.kind === "AUDIO" ? "audio.voice" : "video.primary";
      clips.push({
        id: `clip-${clipIndex + 1}`,
        trackKey,
        order: clips.filter((clip) => clip.trackKey === trackKey).length,
        assetId: asset.assetId,
        storySceneId: role.storySceneId,
        mediaRole: role.role,
        timelineStartMs: trackKey === "video.primary" ? cursorMs : clips[clips.length - 1]?.timelineStartMs ?? 0,
        timelineEndMs:
          trackKey === "video.primary"
            ? cursorMs + duration
            : (clips[clips.length - 1]?.timelineStartMs ?? 0) + duration,
        sourceInMs: 0,
        sourceOutMs: durationForSource(asset, duration),
        transitionFromPrevious: "CUT",
      });
      usedAssets.add(asset.assetId);
      if (trackKey === "video.primary") {
        cursorMs += duration;
      }
      clipIndex += 1;
    }

    const maxEnd = clips.reduce((max, clip) => Math.max(max, clip.timelineEndMs), 0);
    const title = input.priorTimeline && "title" in input.priorTimeline
      ? input.priorTimeline.title
      : input.story.title;

    return {
      schemaVersion: TIMELINE_DOCUMENT_SCHEMA_VERSION,
      title,
      totalDurationMs: maxEnd,
      tracks: DEFAULT_TIMELINE_TRACKS,
      clips,
      unmetMediaRoles: unmet.length > 0 ? unmet : undefined,
      source: {
        storyStructureId: input.storyStructureId,
        storyStructureVersion: input.storyStructureVersion,
        storyFingerprint: input.storyFingerprint,
      },
      rationale:
        "Local deterministic timeline composer: ordered cut from a READY story using existing MediaAsset rows only. Unmet roles recorded for later. Not production AI.",
    };
  }
}

function collectMediaRoles(story: TimelineComposerInput["story"]) {
  const roles: Array<{ role: string; storySceneId: string }> = [];
  for (const act of story.acts) {
    for (const scene of [...act.scenes].sort((a, b) => a.order - b.order)) {
      for (const mediaRole of scene.mediaRoles) {
        roles.push({ role: mediaRole.role, storySceneId: scene.id });
      }
    }
  }
  return roles;
}

function priorClipChoices(prior: TimelineComposerInput["priorTimeline"]) {
  if (!prior?.clips) {
    return [];
  }
  return [...prior.clips]
    .sort((a, b) => a.order - b.order)
    .map((clip) => ({
      assetId: clip.assetId,
      trackKey: clip.trackKey,
      mediaRole: "mediaRole" in clip ? clip.mediaRole : undefined,
      storySceneId: "storySceneId" in clip ? clip.storySceneId : undefined,
    }));
}

function pickAssetForRole(
  inventory: TimelineMediaInventoryItem[],
  used: Set<string>,
  role: string,
): TimelineMediaInventoryItem | undefined {
  const unused = inventory.filter((item) => !used.has(item.assetId));
  if (unused.length === 0) {
    return undefined;
  }
  const wantsAudio = /audio|voice|music|sound/i.test(role);
  if (wantsAudio) {
    return unused.find((item) => item.kind === "AUDIO") ?? unused[0];
  }
  return (
    unused.find((item) => item.kind === "VIDEO") ??
    unused.find((item) => item.kind === "PHOTO") ??
    unused[0]
  );
}

function clipDurationMs(asset: TimelineMediaInventoryItem) {
  if (asset.kind === "PHOTO") {
    return STILL_DURATION_MS;
  }
  if (asset.durationMs && asset.durationMs > 0) {
    return Math.min(asset.durationMs, 12_000);
  }
  return FALLBACK_CLIP_MS;
}

function durationForSource(asset: TimelineMediaInventoryItem, placedMs: number) {
  if (asset.kind === "PHOTO") {
    return placedMs;
  }
  if (asset.durationMs && asset.durationMs > 0) {
    return Math.min(asset.durationMs, placedMs);
  }
  return placedMs;
}
