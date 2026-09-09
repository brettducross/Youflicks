import { AppError } from "@/lib/errors";
import { looksLikeVendorUrl } from "@/server/playback/opaque-key";
import type {
  PublicationPayload,
  PublicationShareLinkInput,
  PublicationView,
} from "@/server/publication/schema";

const FORBIDDEN_KEYS = [
  "apiKey",
  "authorization",
  "password",
  "token",
  "shareToken",
  "ANALYSIS_HTTP_API_KEY",
  "STORY_HTTP_API_KEY",
  "TIMELINE_HTTP_API_KEY",
  "DIRECTOR_HTTP_API_KEY",
  "ASSET_HTTP_API_KEY",
  "RENDER_HTTP_API_KEY",
  "SHARE_TOKEN_SECRET",
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
  "outputKey",
  "storageKey",
  "billing",
  "subscription",
  "quota",
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

export function assertPublicationInputPrivacy(input: PublicationShareLinkInput | Record<string, unknown>) {
  const hits: string[] = [];
  walk(input, "publicationInput", hits);
  if (hits.length > 0) {
    throw AppError.publicationInputInvalid(
      "Share / export input contains private, sponsor, secret, or vendor-host fields that must not be sent.",
      { paths: hits },
    );
  }
  const urlHits: string[] = [];
  assertNoVendorHostUrls(input, "publicationInput", urlHits);
  if (urlHits.length > 0) {
    throw AppError.publicationInputInvalid(
      "Share / export input must not use vendor-host URLs as domain truth.",
      { paths: urlHits },
    );
  }
}

/** Public publication views never carry raw tokens, emails, storage keys, or vendor URLs. */
export function assertPublicationViewPrivacy(view: PublicationView) {
  const hits: string[] = [];
  walk(view, "publication", hits);
  if (hits.length > 0) {
    throw AppError.publicationInputInvalid(
      "Publications must not include secrets, storage keys, sponsor, or vendor-host fields.",
      { paths: hits },
    );
  }
  const urlHits: string[] = [];
  assertNoVendorHostUrls(view, "publication", urlHits);
  if (urlHits.length > 0) {
    throw AppError.publicationInputInvalid(
      "Publications must not use vendor-host URLs as domain truth.",
      { paths: urlHits },
    );
  }
}

export function sanitizePublicationPayload(payload: unknown): PublicationPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const adapterMeta =
    raw.adapterMeta && typeof raw.adapterMeta === "object" && !Array.isArray(raw.adapterMeta)
      ? sanitizeAdapterMeta(raw.adapterMeta as Record<string, unknown>)
      : undefined;
  const clean: PublicationPayload = {
    schemaVersion: "1.0",
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : undefined,
    revokedAt: typeof raw.revokedAt === "string" ? raw.revokedAt : undefined,
    tokenFingerprint: typeof raw.tokenFingerprint === "string" ? raw.tokenFingerprint : undefined,
    adapterMeta,
  };
  return clean;
}

function sanitizeAdapterMeta(meta: Record<string, unknown>) {
  const hits: string[] = [];
  walk(meta, "adapterMeta", hits);
  if (hits.length > 0) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (typeof value === "string" && looksLikeVendorUrl(value)) {
        continue;
      }
      out[key] = value;
    }
  }
  return out;
}
