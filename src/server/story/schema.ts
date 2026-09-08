import { z } from "zod";

export const STORY_DOCUMENT_SCHEMA_VERSION = "1.0" as const;

export const DRAMATIC_FUNCTIONS = [
  "exposition",
  "inciting",
  "development",
  "turning",
  "climax",
  "resolution",
  "motif",
  "punctuation",
] as const;

export type DramaticFunction = (typeof DRAMATIC_FUNCTIONS)[number];

/**
 * A narrative media role — not a Timeline clip ID and not editorial truth.
 */
export const storyMediaRoleSchema = z
  .object({
    role: z.string().min(1).max(64),
    purpose: z.string().max(500).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

export const storySceneSchema = z
  .object({
    id: z.string().min(1).max(64),
    order: z.number().int().nonnegative(),
    title: z.string().max(240).optional(),
    purpose: z.string().min(1).max(2000),
    dramaticFunction: z.enum(DRAMATIC_FUNCTIONS),
    mood: z.string().max(240).optional(),
    pacing: z.string().max(240).optional(),
    mediaRoles: z.array(storyMediaRoleSchema),
    voiceOverOutline: z.string().max(4000).optional(),
    dialogueOutline: z.string().max(4000).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const storyActSchema = z
  .object({
    id: z.string().min(1).max(64),
    order: z.number().int().nonnegative(),
    title: z.string().max(240).optional(),
    purpose: z.string().min(1).max(2000),
    /** Narrative/structural target only — never editorial startMs/endMs. */
    targetDurationMs: z.number().int().positive().optional(),
    scenes: z.array(storySceneSchema).min(1),
  })
  .strict();

export const storySpineSchema = z
  .object({
    opening: z.string().min(1).max(2000),
    development: z.string().min(1).max(2000),
    resolution: z.string().min(1).max(2000),
  })
  .strict();

export const storySourceSchema = z
  .object({
    creativePlanId: z.string().min(1).max(128),
    creativePlanVersion: z.number().int().positive(),
    planFingerprint: z.string().max(128).optional(),
  })
  .strict();

export const storyDocumentSchema = z
  .object({
    schemaVersion: z.literal(STORY_DOCUMENT_SCHEMA_VERSION),
    title: z.string().max(240).optional(),
    logline: z.string().max(500).optional(),
    spine: storySpineSchema,
    acts: z.array(storyActSchema).min(1),
    source: storySourceSchema,
    rationale: z.string().max(4000).optional(),
  })
  .strict();

export type StoryMediaRole = z.infer<typeof storyMediaRoleSchema>;
export type StoryScene = z.infer<typeof storySceneSchema>;
export type StoryAct = z.infer<typeof storyActSchema>;
export type StorySpine = z.infer<typeof storySpineSchema>;
export type StorySource = z.infer<typeof storySourceSchema>;
export type StoryDocument = z.infer<typeof storyDocumentSchema>;

/** Continuity subset when a full prior document is not used. */
export type StoryNarrativeSubset = Pick<StoryDocument, "title" | "logline" | "spine" | "acts">;
