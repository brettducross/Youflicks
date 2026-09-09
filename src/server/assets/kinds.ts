import { AssetCapability, type AssetCapabilityValue } from "@/server/ports/capabilities";

/** Locked M3 GeneratedAsset kinds (D10 / R3). */
export const GENERATED_ASSET_KINDS = [
  "IMAGE",
  "VOICE_OVER",
  "MUSIC",
  "SFX",
  "VIDEO_CLIP",
  "ENHANCEMENT",
] as const;

export type GeneratedAssetKind = (typeof GENERATED_ASSET_KINDS)[number];

export const GENERATED_ASSET_ORIGINS = ["GENERATED", "PROCESSED"] as const;

export type GeneratedAssetOrigin = (typeof GENERATED_ASSET_ORIGINS)[number];

export const KIND_TO_CAPABILITY: Record<GeneratedAssetKind, AssetCapabilityValue> = {
  IMAGE: AssetCapability.IMAGE_GENERATION,
  VOICE_OVER: AssetCapability.VOICE_SYNTHESIS,
  MUSIC: AssetCapability.MUSIC_GENERATION,
  SFX: AssetCapability.SFX_GENERATION,
  VIDEO_CLIP: AssetCapability.VIDEO_GENERATION,
  ENHANCEMENT: AssetCapability.MEDIA_ENHANCEMENT,
};

export const KIND_TO_ORIGIN: Record<GeneratedAssetKind, GeneratedAssetOrigin> = {
  IMAGE: "GENERATED",
  VOICE_OVER: "GENERATED",
  MUSIC: "GENERATED",
  SFX: "GENERATED",
  VIDEO_CLIP: "GENERATED",
  ENHANCEMENT: "PROCESSED",
};

const IMAGE_MIME = /^image\//i;
const AUDIO_MIME = /^audio\//i;
const VIDEO_MIME = /^video\//i;

export function capabilityForKind(kind: GeneratedAssetKind): AssetCapabilityValue {
  return KIND_TO_CAPABILITY[kind];
}

export function originForKind(kind: GeneratedAssetKind): GeneratedAssetOrigin {
  return KIND_TO_ORIGIN[kind];
}

export function inferKindFromRole(role: string): GeneratedAssetKind {
  if (/enhance|upscale|restore|cleanup/i.test(role)) {
    return "ENHANCEMENT";
  }
  if (/voice|narrat|\bvo\b/i.test(role)) {
    return "VOICE_OVER";
  }
  if (/music|score|soundtrack|underscore/i.test(role)) {
    return "MUSIC";
  }
  if (/sfx|foley|sound.?effect/i.test(role)) {
    return "SFX";
  }
  if (/video|clip|b-?roll|footage|motion/i.test(role)) {
    return "VIDEO_CLIP";
  }
  return "IMAGE";
}

export function mimeMatchesKind(kind: GeneratedAssetKind, mimeType: string): boolean {
  switch (kind) {
    case "IMAGE":
      return IMAGE_MIME.test(mimeType);
    case "VOICE_OVER":
    case "MUSIC":
    case "SFX":
      return AUDIO_MIME.test(mimeType);
    case "VIDEO_CLIP":
      return VIDEO_MIME.test(mimeType);
    case "ENHANCEMENT":
      return IMAGE_MIME.test(mimeType) || AUDIO_MIME.test(mimeType) || VIDEO_MIME.test(mimeType);
    default:
      return false;
  }
}

export function isGeneratedAssetKind(value: string): value is GeneratedAssetKind {
  return (GENERATED_ASSET_KINDS as readonly string[]).includes(value);
}
