import { z } from "zod";

export const TIMELINE_DOCUMENT_SCHEMA_VERSION = "1.0" as const;

/** Fixed YouFlicks cut track vocabulary — not arbitrary NLE tracks. */
export const TIMELINE_TRACK_KEYS = [
  "video.primary",
  "audio.voice",
  "audio.music",
  "caption.main",
] as const;

export type TimelineTrackKey = (typeof TIMELINE_TRACK_KEYS)[number];

export const TIMELINE_TRACK_KINDS = ["VIDEO", "AUDIO", "CAPTION"] as const;

export type TimelineTrackKind = (typeof TIMELINE_TRACK_KINDS)[number];

export const TRACK_KIND_BY_KEY: Record<TimelineTrackKey, TimelineTrackKind> = {
  "video.primary": "VIDEO",
  "audio.voice": "AUDIO",
  "audio.music": "AUDIO",
  "caption.main": "CAPTION",
};

/** Light transitions only — not effect graphs. */
export const TIMELINE_TRANSITIONS = ["CUT", "DISSOLVE", "FADE"] as const;

export type TimelineTransition = (typeof TIMELINE_TRANSITIONS)[number];

export const timelineTrackSchema = z
  .object({
    trackKey: z.enum(TIMELINE_TRACK_KEYS),
    kind: z.enum(TIMELINE_TRACK_KINDS),
    label: z.string().max(120).optional(),
  })
  .strict();

export const timelineClipSchema = z
  .object({
    id: z.string().min(1).max(64),
    trackKey: z.enum(TIMELINE_TRACK_KEYS),
    order: z.number().int().nonnegative(),
    /** Required MediaAsset id. Never GeneratedAsset. Never null. */
    assetId: z.string().min(1).max(128),
    storySceneId: z.string().max(64).optional(),
    mediaRole: z.string().max(64).optional(),
    timelineStartMs: z.number().int().nonnegative(),
    timelineEndMs: z.number().int().positive(),
    sourceInMs: z.number().int().nonnegative().optional(),
    sourceOutMs: z.number().int().nonnegative().optional(),
    transitionFromPrevious: z.enum(TIMELINE_TRANSITIONS).optional(),
    captionText: z.string().max(2000).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const unmetMediaRoleSchema = z
  .object({
    role: z.string().min(1).max(64),
    storySceneId: z.string().max(64).optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const timelineSourceSchema = z
  .object({
    storyStructureId: z.string().min(1).max(128),
    storyStructureVersion: z.number().int().positive(),
    storyFingerprint: z.string().max(128).optional(),
  })
  .strict();

export const timelineDocumentSchema = z
  .object({
    schemaVersion: z.literal(TIMELINE_DOCUMENT_SCHEMA_VERSION),
    title: z.string().max(240).optional(),
    totalDurationMs: z.number().int().nonnegative(),
    tracks: z.array(timelineTrackSchema).min(1),
    clips: z.array(timelineClipSchema),
    unmetMediaRoles: z.array(unmetMediaRoleSchema).optional(),
    source: timelineSourceSchema,
    rationale: z.string().max(4000).optional(),
  })
  .strict();

export type TimelineTrack = z.infer<typeof timelineTrackSchema>;
export type TimelineClipDocument = z.infer<typeof timelineClipSchema>;
export type UnmetMediaRole = z.infer<typeof unmetMediaRoleSchema>;
export type TimelineSource = z.infer<typeof timelineSourceSchema>;
export type TimelineDocument = z.infer<typeof timelineDocumentSchema>;

/** Continuity subset when a full prior document is not used: clip order / prior choices. */
export type TimelineContinuitySubset = {
  title?: string;
  clips: Array<
    Pick<TimelineClipDocument, "assetId" | "trackKey" | "order" | "mediaRole" | "storySceneId">
  >;
};

export const DEFAULT_TIMELINE_TRACKS: TimelineTrack[] = [
  { trackKey: "video.primary", kind: "VIDEO", label: "Picture" },
  { trackKey: "audio.voice", kind: "AUDIO", label: "Voice" },
  { trackKey: "audio.music", kind: "AUDIO", label: "Music" },
  { trackKey: "caption.main", kind: "CAPTION", label: "Captions" },
];
