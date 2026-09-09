import { AppError } from "@/lib/errors";
import type { TimelineComposerInput } from "@/server/timeline/input";

const FORBIDDEN_INPUT_KEYS = [
  "apiKey",
  "authorization",
  "password",
  "token",
  "ANALYSIS_HTTP_API_KEY",
  "STORY_HTTP_API_KEY",
  "TIMELINE_HTTP_API_KEY",
  "DIRECTOR_HTTP_API_KEY",
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
  "generatedAsset",
  "generatedAssets",
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
];

const FORBIDDEN_DOCUMENT_KEYS = [
  "generatedAsset",
  "generatedAssets",
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
    const childPath = `${path}.${key}`;
    if (key === "generatedAssetId" && !isAllowedGeneratedAssetIdPath(childPath)) {
      hits.push(childPath);
    }
    if (forbidden.includes(key)) {
      hits.push(childPath);
    }
    walk(child, childPath, hits, forbidden);
  }
}

/** YouFlicks clip/inventory ids are legal. Root-level or vendor-blob ids are not. */
function isAllowedGeneratedAssetIdPath(path: string) {
  return (
    /\.clips\[\d+\]\.generatedAssetId$/.test(path) ||
    /\.generatedInventory\[\d+\]\.generatedAssetId$/.test(path)
  );
}

/** Timeline composer input must be a minimized YouFlicks brief. */
export function assertTimelineComposerInputPrivacy(input: TimelineComposerInput) {
  const hits: string[] = [];
  walk(input, "timelineComposerInput", hits, FORBIDDEN_INPUT_KEYS);
  if (hits.length > 0) {
    throw AppError.timelineInputInvalid(
      "Timeline composer input contains private, sponsor, render, or vendor-host fields that must not be sent.",
      { paths: hits },
    );
  }
}

/**
 * Reject render, VLC, GeneratedAsset, sponsor, or provider-host smuggling
 * anywhere in a TimelineDocument payload. Timing and clips are legal here.
 */
export function assertNoSmuggledRenderFields(value: unknown) {
  const hits: string[] = [];
  walk(value, "timelineDocument", hits, FORBIDDEN_DOCUMENT_KEYS);
  if (hits.length > 0) {
    throw AppError.timelineDocumentInvalid(
      "Timeline documents must not include render, VLC, sponsor, or provider-host fields.",
      { paths: hits },
    );
  }
}
