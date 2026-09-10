import { z } from "zod";
import { GENERATED_ASSET_KINDS } from "@/server/assets/kinds";
import { AssetCapability, type AssetCapabilityValue } from "@/server/ports/capabilities";

/**
 * YouFlicks-owned /v1/generate body. Matches HttpAssetGeneratorAdapter.
 * Extra vendor fields are ignored — they never become CreativePlan/Story/Timeline.
 */
export const yfGenerateRequestSchema = z
  .object({
    model: z.string().min(1).max(256).optional(),
    kind: z.enum(GENERATED_ASSET_KINDS),
    role: z.string().min(1).max(64),
    input: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type YfGenerateRequest = z.infer<typeof yfGenerateRequestSchema>;

export const yfGenerateSuccessSchema = z
  .object({
    mimeType: z.string().min(1).max(128),
    bytesBase64: z.string().min(1),
    durationMs: z.number().int().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    jobId: z.string().min(1).max(128).optional(),
  })
  .strict();

export type YfGenerateSuccess = z.infer<typeof yfGenerateSuccessSchema>;

export const KIND_TO_GATEWAY_CAPABILITY: Record<(typeof GENERATED_ASSET_KINDS)[number], AssetCapabilityValue> =
  {
    IMAGE: AssetCapability.IMAGE_GENERATION,
    VOICE_OVER: AssetCapability.VOICE_SYNTHESIS,
    MUSIC: AssetCapability.MUSIC_GENERATION,
    SFX: AssetCapability.SFX_GENERATION,
    VIDEO_CLIP: AssetCapability.VIDEO_GENERATION,
    ENHANCEMENT: AssetCapability.MEDIA_ENHANCEMENT,
  };

export function capabilityForGenerateKind(
  kind: (typeof GENERATED_ASSET_KINDS)[number],
): AssetCapabilityValue {
  return KIND_TO_GATEWAY_CAPABILITY[kind];
}

export type GatewayErrorBody = {
  error: string;
  code: string;
  capability?: string;
};

export function gatewayError(
  status: number,
  code: string,
  error: string,
  extra?: { capability?: string },
): { ok: false; status: number; body: GatewayErrorBody } {
  return {
    ok: false,
    status,
    body: {
      error,
      code,
      ...extra,
    },
  };
}
