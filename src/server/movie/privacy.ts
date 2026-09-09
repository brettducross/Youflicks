import { AppError } from "@/lib/errors";
import { looksLikeVendorUrl } from "@/server/playback/opaque-key";
import type { FinishedMovieView, MovieKeepInput } from "@/server/movie/schema";

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

/** Keep requests stay a minimized owner action — no sponsor, secrets, or vendor URLs. */
export function assertMovieKeepInputPrivacy(input: MovieKeepInput) {
  const hits: string[] = [];
  walk(input, "movieKeepInput", hits);
  if (hits.length > 0) {
    throw AppError.movieInputInvalid(
      "Keep input contains private, sponsor, or vendor-host fields that must not be sent.",
      { paths: hits },
    );
  }
  const urlHits: string[] = [];
  assertNoVendorHostUrls(input, "movieKeepInput", urlHits);
  if (urlHits.length > 0) {
    throw AppError.movieInputInvalid("Keep input must not use vendor-host URLs as domain truth.", {
      paths: urlHits,
    });
  }
}

/** Public library views never carry storage keys, emails, or vendor URLs. */
export function assertFinishedMovieViewPrivacy(view: FinishedMovieView) {
  const hits: string[] = [];
  walk(view, "finishedMovie", hits);
  if (hits.length > 0) {
    throw AppError.movieInputInvalid(
      "Library films must not include storage keys, sponsor, or vendor-host fields.",
      { paths: hits },
    );
  }
  const urlHits: string[] = [];
  assertNoVendorHostUrls(view, "finishedMovie", urlHits);
  if (urlHits.length > 0) {
    throw AppError.movieOutputInvalid("Library films must not use vendor-host URLs as domain truth.", {
      paths: urlHits,
    });
  }
}
