import { AppError } from "@/lib/errors";
import { looksLikeVendorUrl } from "@/server/playback/opaque-key";

/** Opaque StoragePort keys only. Vendor CDN / protocol URLs are never domain truth. */
export function assertLibraryStorageKey(storageKey: string, field = "storageKey") {
  const key = storageKey.trim();
  if (!key) {
    throw AppError.movieOutputInvalid("A kept film must have an opaque library storage key.", {
      field,
    });
  }
  if (looksLikeVendorUrl(key) || key.includes("://")) {
    throw AppError.movieOutputInvalid(
      "Library keep requires an opaque StoragePort key. Vendor URLs are not domain truth.",
      { field },
    );
  }
  if (key.includes("..") || key.startsWith("/")) {
    throw AppError.movieOutputInvalid("Library storage keys must be opaque relative object keys.", {
      field,
    });
  }
  return key;
}

export function assertRenderOutputKey(outputKey: string) {
  return assertLibraryStorageKey(outputKey, "outputKey");
}
