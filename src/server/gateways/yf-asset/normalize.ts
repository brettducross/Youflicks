import type { NormalizedAssetMeta } from "@/server/gateways/yf-asset/jobs";

/**
 * Pull a single asset URL + optional media metadata from a backend payload.
 * The raw payload is not retained as CreativePlan / Story / Timeline truth.
 */
export function normalizeBackendAsset(payload: unknown): NormalizedAssetMeta | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const nestedPayload = isRecord(record.payload) ? record.payload : record;

  const url =
    pickUrl(nestedPayload.video) ??
    stringUrl(nestedPayload.video_url) ??
    pickUrl(nestedPayload.image) ??
    stringUrl(nestedPayload.image_url) ??
    firstUrl(nestedPayload.images) ??
    firstUrl(nestedPayload.videos) ??
    stringUrl(nestedPayload.output) ??
    firstUrl(nestedPayload.output) ??
    pickNested(nestedPayload.output, "video") ??
    pickNested(nestedPayload.output, "image") ??
    stringUrl(nestedPayload.url);

  if (!url) {
    return null;
  }

  return {
    url,
    mimeType:
      pickString(nestedPayload, "content_type") ??
      pickString(nestedPayload, "mimeType") ??
      pickString(isRecord(nestedPayload.video) ? nestedPayload.video : undefined, "content_type") ??
      pickString(isRecord(nestedPayload.image) ? nestedPayload.image : undefined, "content_type"),
    durationMs: pickInt(nestedPayload, "duration_ms") ?? secondsToMs(nestedPayload.duration),
    width: pickInt(nestedPayload, "width") ?? pickInt(isRecord(nestedPayload.video) ? nestedPayload.video : undefined, "width"),
    height:
      pickInt(nestedPayload, "height") ??
      pickInt(isRecord(nestedPayload.video) ? nestedPayload.video : undefined, "height"),
  };
}

export function extractBackendRequestId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const id = record.request_id ?? record.requestId ?? record.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

export function mapQueueStatus(raw: unknown): "queued" | "running" | "succeeded" | "failed" {
  const value = typeof raw === "string" ? raw.toUpperCase() : "";
  if (
    value === "COMPLETED" ||
    value === "OK" ||
    value === "SUCCEEDED" ||
    value === "SUCCESS" ||
    value === "SUCCESSFUL"
  ) {
    return "succeeded";
  }
  if (
    value === "IN_PROGRESS" ||
    value === "RUNNING" ||
    value === "PROCESSING" ||
    value === "STARTING"
  ) {
    return value === "STARTING" ? "queued" : "running";
  }
  if (
    value === "FAILED" ||
    value === "ERROR" ||
    value === "CANCELLED" ||
    value === "CANCELED"
  ) {
    return "failed";
  }
  return "queued";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringUrl(value: unknown): string | undefined {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;
}

function pickUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return stringUrl(value);
  }
  if (isRecord(value)) {
    return stringUrl(value.url);
  }
  return undefined;
}

function firstUrl(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const item of value) {
    const url = pickUrl(item);
    if (url) {
      return url;
    }
  }
  return undefined;
}

function pickNested(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return pickUrl(value[key]) ?? stringUrl(value[`${key}_url`]);
}

function pickString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickInt(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return undefined;
}

function secondsToMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value * 1000);
  }
  return undefined;
}
