import { AppError } from "@/lib/errors";
import type { AssetGeneratorInput } from "@/server/assets/input";

const FORBIDDEN_INPUT_KEYS = [
  "apiKey",
  "authorization",
  "password",
  "token",
  "ANALYSIS_HTTP_API_KEY",
  "STORY_HTTP_API_KEY",
  "TIMELINE_HTTP_API_KEY",
  "DIRECTOR_HTTP_API_KEY",
  "ASSET_HTTP_API_KEY",
  "YF_GATEWAY_API_KEY",
  "YF_GATEWAY_BACKEND_API_KEY",
  "FAL_KEY",
  "sponsor",
  "sponsors",
  "campaign",
  "offer",
  "placement",
  "email",
  "userId",
  "storageKey",
  "previewKey",
  "tasteProfile",
  "signals",
  "render",
  "renderSpec",
  "renderManifest",
  "ffmpeg",
  "codec",
  "vlc",
  "libvlc",
  "playback",
  "hostJson",
  "providerPayload",
  "rawHost",
  "cdnUrl",
  "vendorUrl",
];

const FORBIDDEN_DOCUMENT_KEYS = [
  "render",
  "renderSpec",
  "renderManifest",
  "ffmpeg",
  "codec",
  "vlc",
  "libvlc",
  "playback",
  "hostJson",
  "providerPayload",
  "rawHost",
  "sponsor",
  "sponsors",
  "apiKey",
  "authorization",
  "cdnUrl",
  "vendorUrl",
  "externalUrl",
];

function walk(value: unknown, path: string, hits: string[], forbidden: string[]) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, hits, forbidden));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.includes(key)) {
      hits.push(`${path}.${key}`);
    }
    walk(child, `${path}.${key}`, hits, forbidden);
  }
}

function looksLikeVendorUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^s3:\/\//i.test(value);
}

/** Asset generator input must be a minimized YouFlicks brief. */
export function assertAssetGeneratorInputPrivacy(input: AssetGeneratorInput) {
  const hits: string[] = [];
  walk(input, "assetGeneratorInput", hits, FORBIDDEN_INPUT_KEYS);
  if (hits.length > 0) {
    throw AppError.assetInputInvalid(
      "Asset generator input contains private, sponsor, render, or storage fields that must not be sent.",
      { paths: hits },
    );
  }
}

/**
 * Reject render, VLC, sponsor, or provider-host smuggling
 * anywhere in a GeneratedAssetDocument payload.
 */
export function assertNoSmuggledVendorFields(value: unknown) {
  const hits: string[] = [];
  walk(value, "generatedAssetDocument", hits, FORBIDDEN_DOCUMENT_KEYS);
  if (hits.length > 0) {
    throw AppError.assetDocumentInvalid(
      "Generated asset documents must not include render, VLC, sponsor, or provider-host fields.",
      { paths: hits },
    );
  }
  assertNoVendorHostUrls(value, "generatedAssetDocument", hits);
  if (hits.length > 0) {
    throw AppError.assetDocumentInvalid(
      "Generated asset documents must not use vendor-host URLs as domain truth.",
      { paths: hits },
    );
  }
}

function assertNoVendorHostUrls(value: unknown, path: string, hits: string[]) {
  if (typeof value === "string" && looksLikeVendorUrl(value)) {
    hits.push(path);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoVendorHostUrls(item, `${path}[${index}]`, hits));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertNoVendorHostUrls(child, `${path}.${key}`, hits);
  }
}
