import { describe, expect, it } from "vitest";
import { ReplicateVideoBackend } from "@/server/gateways/yf-asset/backends/replicate";
import { parseYfAssetGatewayConfig } from "@/server/gateways/yf-asset/config";
import {
  createRecordedReplicateFetch,
  RECORDED_FILE_GET_URL,
  RECORDED_OUTPUT_URL,
  RECORDED_PREDICTION_ID,
} from "@/server/gateways/yf-asset/fixtures/replicate/recorded-fetch";
import { mapQueueStatus, normalizeBackendAsset } from "@/server/gateways/yf-asset/normalize";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function replicateConfig(overrides: Record<string, string | undefined> = {}) {
  return parseYfAssetGatewayConfig({
    YF_GATEWAY_API_KEY: "gw-key",
    YF_GATEWAY_BACKEND: "replicate",
    REPLICATE_API_TOKEN: "r8_recorded_token",
    YF_GATEWAY_POLL_MS: "1",
    ...overrides,
  });
}

describe("ReplicateVideoBackend", () => {
  it("uploads start frames with authenticated files.create and returns a normalized URL", async () => {
    const fetchImpl = createRecordedReplicateFetch();
    const backend = new ReplicateVideoBackend(replicateConfig(), fetchImpl);
    const submitted = await backend.submit({
      model: "wan-video/wan-2.7-i2v",
      prompt: "Gold light on the porch.",
      extra: { imageBytesBase64: PNG_1X1.toString("base64") },
    });
    expect(submitted.backendRequestId).toBe(RECORDED_PREDICTION_ID);
    await expect(backend.status("wan-video/wan-2.7-i2v", submitted.backendRequestId)).resolves.toMatchObject({
      status: "succeeded",
    });
    await expect(backend.result("wan-video/wan-2.7-i2v", submitted.backendRequestId)).resolves.toMatchObject({
      url: RECORDED_OUTPUT_URL,
    });
  });

  it("uses the open-string model path so swapping YF_GATEWAY_MODEL needs no code change", async () => {
    const fetchImpl = createRecordedReplicateFetch({ model: "other/open-string-i2v" });
    const backend = new ReplicateVideoBackend(
      replicateConfig({ YF_GATEWAY_MODEL: "other/open-string-i2v" }),
      fetchImpl,
    );
    const submitted = await backend.submit({
      model: "other/open-string-i2v",
      prompt: "clip",
      extra: { imageBytesBase64: PNG_1X1.toString("base64") },
    });
    expect(submitted.backendRequestId).toBe(RECORDED_PREDICTION_ID);
  });

  it("refuses public file hosts instead of uploading via catbox or 0x0", async () => {
    const backend = new ReplicateVideoBackend(replicateConfig(), createRecordedReplicateFetch());
    await expect(
      backend.submit({
        model: "wan-video/wan-2.7-i2v",
        prompt: "clip",
        extra: { first_frame: "https://files.catbox.moe/start.png" },
      }),
    ).rejects.toThrow(/public file host/i);
    await expect(
      backend.submit({
        model: "wan-video/wan-2.7-i2v",
        prompt: "clip",
        extra: { image: "https://0x0.st/start.png" },
      }),
    ).rejects.toThrow(/public file host/i);
  });

  it("fails closed without a token at submit time", async () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "replicate",
    });
    const backend = new ReplicateVideoBackend(config, createRecordedReplicateFetch());
    await expect(
      backend.submit({
        model: "wan-video/wan-2.7-i2v",
        prompt: "clip",
        extra: { imageBytesBase64: PNG_1X1.toString("base64") },
      }),
    ).rejects.toThrow(/REPLICATE_API_TOKEN/);
  });
});

describe("Replicate payload normalization", () => {
  it("reads a string output URL and starting/succeeded statuses", () => {
    expect(mapQueueStatus("starting")).toBe("queued");
    expect(mapQueueStatus("processing")).toBe("running");
    expect(mapQueueStatus("succeeded")).toBe("succeeded");
    expect(
      normalizeBackendAsset({
        id: "pred_1",
        status: "succeeded",
        output: RECORDED_OUTPUT_URL,
      }),
    ).toMatchObject({ url: RECORDED_OUTPUT_URL });
    expect(
      normalizeBackendAsset({
        output: [RECORDED_OUTPUT_URL],
      }),
    ).toMatchObject({ url: RECORDED_OUTPUT_URL });
  });

  it("does not keep vendor JSON fields as the normalized asset", () => {
    const asset = normalizeBackendAsset({
      id: "pred_1",
      logs: "skip",
      metrics: { predict_time: 1 },
      output: RECORDED_OUTPUT_URL,
    });
    expect(asset).not.toHaveProperty("logs");
    expect(asset).not.toHaveProperty("metrics");
    expect(asset).not.toHaveProperty("id");
    expect(RECORDED_FILE_GET_URL).toContain("api.replicate.com");
  });
});
