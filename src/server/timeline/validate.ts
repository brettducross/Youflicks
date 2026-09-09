import { AppError } from "@/lib/errors";
import { assertNoSmuggledRenderFields } from "@/server/timeline/privacy";
import {
  DEFAULT_TIMELINE_TRACKS,
  TIMELINE_DOCUMENT_SCHEMA_VERSION,
  TRACK_KIND_BY_KEY,
  timelineDocumentSchema,
  type TimelineDocument,
  type TimelineTrackKey,
} from "@/server/timeline/schema";

export function validateTimelineDocument(raw: unknown): TimelineDocument {
  assertNoStoryDocumentShape(raw);
  assertNoSmuggledRenderFields(raw);
  const parsed = timelineDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.timelineDocumentInvalid("Timeline document does not match the YouFlicks schema.", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  assertTimelineDocumentSchemaVersion(parsed.data);
  assertTrackKindsMatchKeys(parsed.data);
  assertUniqueTrackKeys(parsed.data);
  assertUniqueClipIds(parsed.data);
  assertClipTiming(parsed.data);
  assertCaptionTextOnlyOnCaptionTracks(parsed.data);
  assertClipsReferenceTracks(parsed.data);
  assertNoNullAssetSlots(parsed.data);
  return parsed.data;
}

export function assertTimelineDocumentSchemaVersion(document: TimelineDocument) {
  if (document.schemaVersion !== TIMELINE_DOCUMENT_SCHEMA_VERSION) {
    throw AppError.timelineDocumentInvalid("Unsupported timeline document schema version.", {
      schemaVersion: document.schemaVersion,
    });
  }
}

function assertNoStoryDocumentShape(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return;
  }
  const record = raw as Record<string, unknown>;
  const looksLikeStory =
    record.spine &&
    typeof record.spine === "object" &&
    Array.isArray(record.acts) &&
    !Array.isArray(record.tracks) &&
    !Array.isArray(record.clips);
  if (looksLikeStory) {
    throw AppError.timelineDocumentInvalid(
      "Timeline documents must not be StoryDocument-shaped. Narrative structure stays on StoryStructure.",
    );
  }
}

function assertTrackKindsMatchKeys(document: TimelineDocument) {
  for (const track of document.tracks) {
    const expected = TRACK_KIND_BY_KEY[track.trackKey];
    if (expected && track.kind !== expected) {
      throw AppError.timelineDocumentInvalid("Timeline track kind must match the locked trackKey.", {
        trackKey: track.trackKey,
        kind: track.kind,
      });
    }
  }
}

function assertUniqueTrackKeys(document: TimelineDocument) {
  const keys = new Set<string>();
  for (const track of document.tracks) {
    if (keys.has(track.trackKey)) {
      throw AppError.timelineDocumentInvalid("Timeline tracks must have unique trackKey values.");
    }
    keys.add(track.trackKey);
  }
}

function assertUniqueClipIds(document: TimelineDocument) {
  const ids = new Set<string>();
  for (const clip of document.clips) {
    if (ids.has(clip.id)) {
      throw AppError.timelineDocumentInvalid("Timeline clips must have unique ids.");
    }
    ids.add(clip.id);
  }
}

function assertClipTiming(document: TimelineDocument) {
  for (const clip of document.clips) {
    if (clip.timelineEndMs <= clip.timelineStartMs) {
      throw AppError.timelineDocumentInvalid(
        "timelineEndMs must be greater than timelineStartMs on every clip.",
        { clipId: clip.id },
      );
    }
    if (
      clip.sourceInMs !== undefined &&
      clip.sourceOutMs !== undefined &&
      clip.sourceOutMs <= clip.sourceInMs
    ) {
      throw AppError.timelineDocumentInvalid(
        "sourceOutMs must be greater than sourceInMs when both are set.",
        { clipId: clip.id },
      );
    }
  }
  const maxEnd = document.clips.reduce((max, clip) => Math.max(max, clip.timelineEndMs), 0);
  if (document.clips.length > 0 && document.totalDurationMs < maxEnd) {
    throw AppError.timelineDocumentInvalid(
      "totalDurationMs must cover the last clip end on the timeline.",
      { totalDurationMs: document.totalDurationMs, maxEnd },
    );
  }
}

function assertCaptionTextOnlyOnCaptionTracks(document: TimelineDocument) {
  const kindByKey = new Map(document.tracks.map((track) => [track.trackKey, track.kind]));
  for (const clip of document.clips) {
    if (clip.captionText && kindByKey.get(clip.trackKey) !== "CAPTION") {
      throw AppError.timelineDocumentInvalid("captionText is only allowed on CAPTION tracks.", {
        clipId: clip.id,
        trackKey: clip.trackKey,
      });
    }
  }
}

function assertClipsReferenceTracks(document: TimelineDocument) {
  const keys = new Set(document.tracks.map((track) => track.trackKey));
  for (const clip of document.clips) {
    if (!keys.has(clip.trackKey as TimelineTrackKey)) {
      throw AppError.timelineDocumentInvalid("Each clip.trackKey must reference tracks[].trackKey.", {
        clipId: clip.id,
        trackKey: clip.trackKey,
      });
    }
  }
}

function assertNoNullAssetSlots(document: TimelineDocument) {
  for (const clip of document.clips) {
    const kind = clip.sourceKind ?? "MEDIA_ASSET";
    if (kind === "MEDIA_ASSET" && !clip.assetId) {
      throw AppError.timelineDocumentInvalid(
        "MEDIA_ASSET clips must reference an existing MediaAsset. Unmet roles belong in unmetMediaRoles.",
        { clipId: clip.id },
      );
    }
    if (kind === "GENERATED_ASSET" && !clip.generatedAssetId) {
      throw AppError.timelineDocumentInvalid(
        "GENERATED_ASSET clips must reference an existing GeneratedAsset.",
        { clipId: clip.id },
      );
    }
  }
}

export function withDefaultTracks(document: TimelineDocument): TimelineDocument {
  if (document.tracks.length > 0) {
    return document;
  }
  return { ...document, tracks: DEFAULT_TIMELINE_TRACKS };
}
