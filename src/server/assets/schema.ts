import { z } from "zod";
import { GENERATED_ASSET_KINDS, GENERATED_ASSET_ORIGINS } from "@/server/assets/kinds";

export const GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION = "1.0" as const;

export const generatedAssetFulfillmentSchema = z
  .object({
    timelineId: z.string().min(1).max(128),
    timelineVersion: z.number().int().positive(),
    storySceneId: z.string().max(64).optional(),
    unmetReason: z.string().max(500).optional(),
  })
  .strict();

export const generatedAssetSourceSchema = z
  .object({
    storyStructureId: z.string().max(128).optional(),
    storyStructureVersion: z.number().int().positive().optional(),
    briefFingerprint: z.string().max(128).optional(),
  })
  .strict();

export const generatedAssetDocumentSchema = z
  .object({
    schemaVersion: z.literal(GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION),
    kind: z.enum(GENERATED_ASSET_KINDS),
    role: z.string().min(1).max(64),
    title: z.string().max(240).optional(),
    mimeType: z.string().min(1).max(128),
    durationMs: z.number().int().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    checksum: z.string().max(128).optional(),
    storageKey: z.string().min(1).max(512),
    previewKey: z.string().max(512).optional(),
    origin: z.enum(GENERATED_ASSET_ORIGINS),
    sourceMediaAssetId: z.string().max(128).optional(),
    fulfillment: generatedAssetFulfillmentSchema,
    source: generatedAssetSourceSchema,
    rationale: z.string().max(4000).optional(),
  })
  .strict();

export type GeneratedAssetFulfillment = z.infer<typeof generatedAssetFulfillmentSchema>;
export type GeneratedAssetSource = z.infer<typeof generatedAssetSourceSchema>;
export type GeneratedAssetDocument = z.infer<typeof generatedAssetDocumentSchema>;
