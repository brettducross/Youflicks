import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { HttpVisionAdapter } from "@/server/adapters/analysis/http-vision";
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

const input: AnalyzeMediaInput = {
  assetId: "a1",
  projectId: "p1",
  storageKey: "projects/p1/a1",
  kind: "PHOTO",
  mimeType: "image/png",
  filename: "still.png",
  byteSize: 8,
  width: 1,
  height: 1,
  durationMs: null,
  checksum: null,
  previewStorageKey: null,
  requestedCapabilities: [AnalysisCapability.IMAGE_ANALYSIS],
};

describe("HttpVisionAdapter", () => {
  it("is disabled when credentials are missing", async () => {
    const adapter = new HttpVisionAdapter(memoryStorage({}), {
      providerKey: "http.vision",
    });
    expect(adapter.configured).toBe(false);
    expect(adapter.enabled).toBe(false);
    expect(adapter.health().available).toBe(false);
    await expect(adapter.analyze(input)).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("loads bytes through StoragePort and maps host JSON to observations", async () => {
    const storage = memoryStorage({ "projects/p1/a1": new Uint8Array([1, 2, 3]) });
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toContain("/chat/completions");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer secret-test-key");
      const body = JSON.parse(String(init?.body));
      expect(JSON.stringify(body)).not.toContain("secret-test-key");
      return new Response(
        JSON.stringify({
          model: "vision-small",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  visual: { sceneDescription: "A slate", objects: ["card"], confidence: 0.6 },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const adapter = new HttpVisionAdapter(
      storage,
      {
        providerKey: "http.vision",
        baseUrl: "https://example.test/v1",
        apiKey: "secret-test-key",
        model: "vision-small",
      },
      fetchImpl,
    );

    const result = await adapter.analyze(input);
    expect(result.providerKey).toBe("http.vision");
    expect(result.modelId).toBe("vision-small");
    expect(result.observations.visual).toMatchObject({ sceneDescription: "A slate" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not leak the API key when the host fails", async () => {
    const adapter = new HttpVisionAdapter(
      memoryStorage({ "projects/p1/a1": new Uint8Array([9]) }),
      {
        providerKey: "http.vision",
        baseUrl: "https://example.test/v1",
        apiKey: "super-secret-key",
        model: "vision-small",
      },
      async () => new Response("unauthorized super-secret-key", { status: 401 }),
    );

    await expect(adapter.analyze(input)).rejects.toBeInstanceOf(AppError);
    try {
      await adapter.analyze(input);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as Error).message).not.toContain("super-secret-key");
    }
  });

  it("rejects invalid host JSON as invalid analysis", async () => {
    const adapter = new HttpVisionAdapter(
      memoryStorage({ "projects/p1/a1": new Uint8Array([1]) }),
      {
        providerKey: "http.vision",
        baseUrl: "https://example.test/v1",
        apiKey: "secret-test-key",
        model: "vision-small",
      },
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "not json at all" } }] }),
          { status: 200 },
        ),
    );
    await expect(adapter.analyze(input)).rejects.toMatchObject({ code: "INVALID_ANALYSIS" });
  });

  it("loads a video poster through StoragePort", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          model: "vision-small",
          choices: [{ message: { content: JSON.stringify({ visual: { sceneDescription: "Poster" } }) } }],
        }),
        { status: 200 },
      );
    });
    const adapter = new HttpVisionAdapter(
      memoryStorage({ "projects/p1/poster": new Uint8Array([4, 5]) }),
      {
        providerKey: "http.vision",
        baseUrl: "https://example.test/v1",
        apiKey: "secret-test-key",
        model: "vision-small",
      },
      fetchImpl,
    );
    const result = await adapter.analyze({
      ...input,
      kind: "VIDEO",
      previewStorageKey: "projects/p1/poster",
      requestedCapabilities: [AnalysisCapability.VIDEO_ANALYSIS],
    });
    expect(result.observations.visual).toMatchObject({ sceneDescription: "Poster" });
  });

  it("requires a poster for video and still uses StoragePort", async () => {
    const adapter = new HttpVisionAdapter(
      memoryStorage({}),
      {
        providerKey: "http.vision",
        baseUrl: "https://example.test/v1",
        apiKey: "k",
        model: "vision-small",
      },
      async () => new Response("{}", { status: 200 }),
    );
    await expect(
      adapter.analyze({ ...input, kind: "VIDEO", requestedCapabilities: [AnalysisCapability.VIDEO_ANALYSIS] }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
  });
});
