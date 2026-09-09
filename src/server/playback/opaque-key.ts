import { AppError } from "@/lib/errors";

/** Opaque StoragePort keys only. Vendor CDN / protocol URLs are never domain truth. */
export function looksLikeVendorUrl(value: string) {
  return /^(https?|s3|gs|ftp|rtsp|rtmp|vlc):\/\//i.test(value.trim());
}

export function assertOpaqueStorageKey(outputKey: string, field = "outputKey") {
  const key = outputKey.trim();
  if (!key) {
    throw AppError.playbackOutputInvalid("A successful render must have an opaque storage key.");
  }
  if (looksLikeVendorUrl(key) || key.includes("://")) {
    throw AppError.playbackOutputInvalid(
      "Playback requires an opaque StoragePort key. Vendor URLs are not domain truth.",
      { field },
    );
  }
  if (key.includes("..") || key.startsWith("/")) {
    throw AppError.playbackOutputInvalid("Playback storage keys must be opaque relative object keys.", {
      field,
    });
  }
  return key;
}

export function assertAppRelativeStreamPath(streamPath: string | undefined) {
  if (streamPath === undefined) {
    return;
  }
  if (!streamPath.startsWith("/api/") || looksLikeVendorUrl(streamPath) || streamPath.includes("://")) {
    throw AppError.playbackOutputInvalid(
      "APP_STREAM paths must be app-relative. Vendor URLs are not domain truth.",
    );
  }
}
