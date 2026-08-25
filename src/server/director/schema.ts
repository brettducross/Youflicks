import { z } from "zod";

export const CREATIVE_PLAN_SCHEMA_VERSION = "1.0" as const;

/**
 * Extensible decision. kind is an open string so future Director
 * decisions do not require a Prisma/vendor enum.
 */
export const directorDecisionSchema = z
  .object({
    kind: z.string().min(1).max(64),
    subject: z.string().max(240).optional(),
    summary: z.string().min(1).max(2000),
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const creativePlanSchema = z
  .object({
    schemaVersion: z.literal(CREATIVE_PLAN_SCHEMA_VERSION),
    concept: z.string().max(500).optional(),
    objective: z.string().max(500).optional(),
    tone: z.string().max(240).optional(),
    emotionalArc: z.string().max(500).optional(),
    narrativeApproach: z.string().max(500).optional(),
    pacing: z.string().max(240).optional(),
    visualDirection: z.string().max(500).optional(),
    musicDirection: z.string().max(500).optional(),
    voiceDirection: z.string().max(500).optional(),
    mediaStrategy: z.string().max(1000).optional(),
    constraints: z.array(z.string()).optional(),
    decisions: z.array(directorDecisionSchema).optional(),
    rationale: z.string().max(4000).optional(),
  })
  .passthrough();

export type DirectorDecision = z.infer<typeof directorDecisionSchema>;
export type CreativePlan = z.infer<typeof creativePlanSchema>;

export const DIRECTOR_DECISION_KINDS = [
  "film_concept",
  "tone",
  "emotional_direction",
  "narrative_approach",
  "pacing",
  "media_selection_strategy",
  "scene_emphasis",
  "music_direction",
  "visual_treatment",
  "voice_direction",
  "ending_direction",
] as const;
