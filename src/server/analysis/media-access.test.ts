import { describe, expect, it } from "vitest";
import { loadVisualObject } from "@/server/analysis/media-access";
import { AnalysisCapability } from "@/server/ports/capabilities";
import type { AnalyzeMediaInput } from "@/server/ports/media-analyzer";
import type { StoragePort } from "@/server/ports/storage";

function memoryStorage(files: Record<string, Uint8Array>): StoragePort {
  return {
    driver: "memory",
    async put() {
      return { key: "x", contentType: "image/png", byteSize: 1 };
    },
    async get(key) {
      const body = files[key];
      if (!body) return null;
      return { key, body, contentType: "image/png" };
    },
    async getStream() {
      return null;
    },
    async delete() {},
    async exists(key) {
      return Boolean(files[key]);
    },
  };
}

const photo: AnalyzeMediaInput = {
  assetId: "a1",
  projectId: "p1",
  storageKey: "projects/p1/original",
  kind: "PHOTO",
  mimeType: "image/png",
  filename: "still.png",
  byteSize: 3,
  width: 1,
  height: 1,
  durationMs: null,
  checksum: null,
  previewStorageKey: null,
  requestedCapabilities: [AnalysisCapability.IMAGE_ANALYSIS],
};

describe("loadVisualObject", () => {
  it("loads photo bytes through StoragePort, not a filesystem path", async () => {
    const storage = memoryStorage({ "projects/p1/original": new Uint8Array([1, 2, 3]) });
    const object = await loadVisualObject(storage, photo);
    expect(object.body).toEqual(new Uint8Array([1, 2, 3]));
    expect(object.usedPreview).toBe(false);
  });

  it("uses the preview storage key for video posters", async () => {
    const storage = memoryStorage({
      "projects/p1/preview": new Uint8Array([9, 9]),
    });
    const object = await loadVisualObject(storage, {
      ...photo,
      kind: "VIDEO",
      storageKey: "projects/p1/original",
      previewStorageKey: "projects/p1/preview",
      requestedCapabilities: [AnalysisCapability.VIDEO_ANALYSIS],
    });
    expect(object.body).toEqual(new Uint8Array([9, 9]));
    expect(object.usedPreview).toBe(true);
  });

  it("fails when the object is missing from storage", async () => {
    await expect(loadVisualObject(memoryStorage({}), photo)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
