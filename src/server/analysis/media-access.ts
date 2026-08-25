import { AppError } from "@/lib/errors";
import type { AnalyzeMediaInput } from "@/server/ports/media-analyzer";
import type { StoragePort } from "@/server/ports/storage";

/**
 * Load visual bytes through StoragePort. Adapters must not open ./storage.
 */
export async function loadVisualObject(storage: StoragePort, input: AnalyzeMediaInput) {
  const key =
    input.kind === "VIDEO" && input.previewStorageKey
      ? input.previewStorageKey
      : input.storageKey;
  const object = await storage.get(key);
  if (!object) {
    throw AppError.notFound("The media object is missing from storage.");
  }
  return { ...object, usedPreview: key !== input.storageKey };
}
