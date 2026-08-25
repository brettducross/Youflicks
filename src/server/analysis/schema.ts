import { z } from "zod";

export const ANALYSIS_SCHEMA_VERSION = "1.0" as const;

const confidence = z.number().min(0).max(1);

export const technicalAnalysisSchema = z
  .object({
    mediaType: z.string().optional(),
    mimeType: z.string().optional(),
    width: z.number().int().nonnegative().nullable().optional(),
    height: z.number().int().nonnegative().nullable().optional(),
    durationMs: z.number().int().nonnegative().nullable().optional(),
    frameRate: z.number().positive().nullable().optional(),
    orientation: z.string().optional(),
    byteSize: z.number().nonnegative().optional(),
    codec: z.string().nullable().optional(),
    bitrate: z.number().nonnegative().nullable().optional(),
    hasAudio: z.boolean().optional(),
    capturedAt: z.string().optional(),
  })
  .passthrough();

export const visualAnalysisSchema = z
  .object({
    sceneDescription: z.string().optional(),
    objects: z.array(z.string()).optional(),
    environments: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    activities: z.array(z.string()).optional(),
    visualQuality: z.string().optional(),
    blur: confidence.optional(),
    exposure: confidence.optional(),
    composition: z.string().optional(),
    cameraMovement: z.string().optional(),
    estimatedImportance: confidence.optional(),
    confidence: confidence.optional(),
  })
  .passthrough();

export const personPresenceSchema = z
  .object({
    anonymousPersonId: z.string(),
    faceDetected: z.boolean().optional(),
    confidence: confidence.optional(),
    positionHint: z.string().optional(),
    startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const peopleAnalysisSchema = z
  .object({
    count: z.number().int().nonnegative().optional(),
    people: z.array(personPresenceSchema).optional(),
    recurringPersonIds: z.array(z.string()).optional(),
    confidence: confidence.optional(),
  })
  .passthrough();

export const speechSegmentSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    text: z.string().optional(),
    confidence: confidence.optional(),
  })
  .passthrough();

export const audioAnalysisSchema = z
  .object({
    present: z.boolean().optional(),
    speechPresent: z.boolean().optional(),
    musicPresent: z.boolean().optional(),
    ambient: z.string().optional(),
    speechSegments: z.array(speechSegmentSchema).optional(),
    transcript: z.string().optional(),
    language: z.string().optional(),
    quality: confidence.optional(),
    confidence: confidence.optional(),
  })
  .passthrough();

export const momentAnalysisSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    description: z.string().optional(),
    importance: confidence.optional(),
    emotionalTone: z.string().optional(),
    confidence: confidence.optional(),
  })
  .passthrough();

export const qualityAssessmentSchema = z
  .object({
    overall: confidence.optional(),
    blur: confidence.optional(),
    exposure: confidence.optional(),
    shake: confidence.optional(),
    audio: confidence.optional(),
    technicallyUsable: z.boolean().optional(),
    editorialUsefulness: confidence.optional(),
  })
  .passthrough();

export const duplicateInfoSchema = z
  .object({
    exact: z.boolean().optional(),
    nearDuplicate: z.boolean().optional(),
    groupId: z.string().optional(),
    similarAssetIds: z.array(z.string()).optional(),
    confidence: confidence.optional(),
  })
  .passthrough();

export const mediaAnalysisDocumentSchema = z
  .object({
    analysisSchemaVersion: z.literal(ANALYSIS_SCHEMA_VERSION),
    technical: technicalAnalysisSchema.optional(),
    visual: visualAnalysisSchema.optional(),
    people: peopleAnalysisSchema.optional(),
    audio: audioAnalysisSchema.optional(),
    moments: z.array(momentAnalysisSchema).optional(),
    quality: qualityAssessmentSchema.optional(),
    duplicates: duplicateInfoSchema.optional(),
  })
  .passthrough();

export type TechnicalAnalysis = z.infer<typeof technicalAnalysisSchema>;
export type VisualAnalysis = z.infer<typeof visualAnalysisSchema>;
export type PeopleAnalysis = z.infer<typeof peopleAnalysisSchema>;
export type AudioAnalysis = z.infer<typeof audioAnalysisSchema>;
export type MomentAnalysis = z.infer<typeof momentAnalysisSchema>;
export type QualityAssessment = z.infer<typeof qualityAssessmentSchema>;
export type DuplicateInfo = z.infer<typeof duplicateInfoSchema>;
export type MediaAnalysisDocument = z.infer<typeof mediaAnalysisDocumentSchema>;
