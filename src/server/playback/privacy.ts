import { AppError } from "@/lib/errors";
import { looksLikeVendorUrl } from "@/server/playback/opaque-key";
import type { PlaybackOpenInput, PlaybackSession } from "@/server/playback/schema";

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
  "tasteProfile",
  "signals",
  "ffmpeg",
  "codec",
  "filterGraph",
  "vlc",
  "libvlc",
  "hostJson",
  "providerPayload",
  "rawHost",
  "cdnUrl",
  "vendorUrl",
  "externalUrl",
  "finishedMovie",
  "publication",
  "outputKey",
  "storageKey",
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

/** Public playback open input must stay a minimized YouFlicks viewing request. */
export function assertPlaybackOpenInputPrivacy(input: PlaybackOpenInput) {
  const hits: string[] = [];
  walk(input, "playbackOpenInput", hits);
  if (hits.length > 0) {
    throw AppError.playbackInputInvalid(
      "Playback input contains private, sponsor, or vendor-host fields that must not be sent.",
      { paths: hits },
    );
  }
  const urlHits: string[] = [];
  assertNoVendorHostUrls(input, "playbackOpenInput", urlHits);
  if (urlHits.length > 0) {
    throw AppError.playbackInputInvalid("Playback input must not use vendor-host URLs as domain truth.", {
      paths: urlHits,
    });
  }
}

/** Public session documents never carry storage keys, emails, or vendor URLs. */
export function assertPlaybackSessionPrivacy(session: PlaybackSession) {
  const hits: string[] = [];
  walk(session, "playbackSession", hits);
  if (hits.length > 0) {
    throw AppError.playbackInputInvalid(
      "Playback sessions must not include storage keys, sponsor, or vendor-host fields.",
      { paths: hits },
    );
  }
  const urlHits: string[] = [];
  assertNoVendorHostUrls(session, "playbackSession", urlHits);
  if (urlHits.length > 0) {
    throw AppError.playbackOutputInvalid("Playback sessions must not use vendor-host URLs as domain truth.", {
      paths: urlHits,
    });
  }
}
