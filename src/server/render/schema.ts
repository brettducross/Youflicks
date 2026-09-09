import { z } from "zod";
import { TIMELINE_CLIP_SOURCE_KINDS, TIMELINE_TRACK_KEYS, TIMELINE_TRANSITIONS } from "@/server/timeline/schema";

export const RENDER_MANIFEST_SCHEMA_VERSION = "1.0" as const;

/** YouFlicks output profiles — not vendor codec enums. */
export const RENDER_OUTPUT_PROFILES = ["WEB_720", "WEB_1080", "MASTER"] as const;

export type RenderOutputProfile = (typeof RENDER_OUTPUT_PROFILES)[number];

export const DEFAULT_RENDER_OUTPUT_PROFILE: RenderOutputProfile = "WEB_1080";

export const renderManifestClipSchema = z
  .object({
    clipId: z.string().min(1).max(64),
    trackKey: z.enum(TIMELINE_TRACK_KEYS),
    sourceKind: z.enum(TIMELINE_CLIP_SOURCE_KINDS),
    sourceId: z.string().min(1).max(128),
    storageKey: z.string().min(1).max(512),
    timelineStartMs: z.number().int().nonnegative(),
    timelineEndMs: z.number().int().positive(),
    sourceInMs: z.number().int().nonnegative().optional(),
    sourceOutMs: z.number().int().nonnegative().optional(),
    transitionFromPrevious: z.enum(TIMELINE_TRANSITIONS).optional(),
    captionText: z.string().max(2000).optional(),
  })
  .strict();

export const renderManifestSchema = z
  .object({
    schemaVersion: z.literal(RENDER_MANIFEST_SCHEMA_VERSION),
    timelineId: z.string().min(1).max(128),
    timelineVersion: z.number().int().positive(),
    totalDurationMs: z.number().int().nonnegative(),
    outputProfile: z.enum(RENDER_OUTPUT_PROFILES),
    clips: z.array(renderManifestClipSchema).min(1),
    audioMixNotes: z.string().max(2000).optional(),
    rationale: z.string().max(4000).optional(),
  })
  .strict();

export const renderResultDocumentSchema = z
  .object({
    storageKey: z.string().min(1).max(512),
    mimeType: z.string().min(1).max(128),
    durationMs: z.number().int().nonnegative(),
    byteSize: z.number().int().nonnegative().optional(),
    checksum: z.string().max(128).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export type RenderManifestClip = z.infer<typeof renderManifestClipSchema>;
export type RenderManifest = z.infer<typeof renderManifestSchema>;
export type RenderResultDocument = z.infer<typeof renderResultDocumentSchema>;

export const renderJobPayloadSchema = z
  .object({
    manifest: renderManifestSchema,
    progress: z
      .object({
        percent: z.number().min(0).max(100).optional(),
        stage: z.string().max(120).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RenderJobPayloadDocument = z.infer<typeof renderJobPayloadSchema>;
