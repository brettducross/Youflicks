import { AppError } from "@/lib/errors";
import type { RenderComposerInput } from "@/server/render/input";

const FORBIDDEN_KEYS = [
  "apiKey",
  "authorization",
  "password",
  "token",
  "ANALYSIS_HTTP_API_KEY",
  "STORY_HTTP_API_KEY",
  "TIMELINE_HTTP_API_KEY",
  "DIRECTOR_HTTP_API_KEY",
  "ASSET_HTTP_API_KEY",
  "RENDER_HTTP_API_KEY",
  "sponsor",
  "sponsors",
  "campaign",
  "offer",
  "placement",
  "email",
  "userId",
  "tasteProfile",
  "signals",
  "ffmpeg",
  "codec",
  "filterGraph",
  "vlc",
  "libvlc",
  "playback",
  "playbackDevice",
  "hostJson",
  "providerPayload",
  "rawHost",
  "cdnUrl",
  "vendorUrl",
  "externalUrl",
  "finishedMovie",
  "publication",
];

function walk(value: unknown, path: string, hits: string[]) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, hits));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_KEYS.includes(key)) {
      hits.push(childPath);
    }
    walk(child, childPath, hits);
  }
}

function looksLikeVendorUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^s3:\/\//i.test(value);
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

/** Render composer input must be a YouFlicks-owned assembly brief. */
export function assertRenderComposerInputPrivacy(input: RenderComposerInput) {
  const hits: string[] = [];
  walk(input, "renderComposerInput", hits);
  if (hits.length > 0) {
    throw AppError.renderInputInvalid(
      "Render input contains private, sponsor, playback, or vendor-host fields that must not be sent.",
      { paths: hits },
    );
  }
  const urlHits: string[] = [];
  assertNoVendorHostUrls(input, "renderComposerInput", urlHits);
  if (urlHits.length > 0) {
    throw AppError.renderInputInvalid(
      "Render input must not use vendor-host URLs as domain truth.",
      { paths: urlHits },
    );
  }
}

/**
 * Reject credentials, sponsor, playback, FFmpeg graphs, or vendor-host smuggling
 * anywhere in a RenderManifest / RenderResultDocument payload.
 */
export function assertNoSmuggledRenderVendorFields(value: unknown, root = "renderDocument") {
  const hits: string[] = [];
  walk(value, root, hits);
  if (hits.length > 0) {
    throw AppError.renderResultInvalid(
      "Render documents must not include playback, sponsor, FFmpeg, or provider-host fields.",
      { paths: hits },
    );
  }
  const urlHits: string[] = [];
  assertNoVendorHostUrls(value, root, urlHits);
  if (urlHits.length > 0) {
    throw AppError.renderResultInvalid(
      "Render documents must use opaque StoragePort keys, not vendor-host URLs.",
      { paths: urlHits },
    );
  }
}
