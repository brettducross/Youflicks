import { describe, expect, it, vi } from "vitest";
import { MockVideoBackend } from "@/server/gateways/yf-asset/backends/mock";
import { ReplicateVideoBackend } from "@/server/gateways/yf-asset/backends/replicate";
import { parseYfAssetGatewayConfig } from "@/server/gateways/yf-asset/config";
import {
  createRecordedReplicateFetch,
  RECORDED_WAN_VIDEO_BYTES,
} from "@/server/gateways/yf-asset/fixtures/replicate/recorded-fetch";
import { YfAssetGenerateService } from "@/server/gateways/yf-asset/generate";
import { GatewayJobStore } from "@/server/gateways/yf-asset/jobs";
import { SpendGuard } from "@/server/gateways/yf-asset/spend";
import { AssetCapability } from "@/server/ports/capabilities";

function service(overrides: Record<string, string | undefined> = {}) {
  const config = parseYfAssetGatewayConfig({
    YF_GATEWAY_API_KEY: "gw-key",
    YF_GATEWAY_BACKEND: "mock",
    YF_GATEWAY_MODEL: "research.ltx",
    YF_GATEWAY_PROVIDER_KEY: "http.asset",
    YF_GATEWAY_POLL_MS: "1",
    YF_GATEWAY_MAX_JOBS: "8",
    YF_GATEWAY_MAX_SPEND_USD: "20",
    ...overrides,
  });
  const backend = new MockVideoBackend();
  const jobs = new GatewayJobStore();
  const spend = new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob);
  const fetchImpl = vi.fn<typeof fetch>(async (url) => {
    expect(String(url)).toBe("https://example.test/generated/clip.mp4");
    return new Response(Buffer.from("fake-mp4"), {
      status: 200,
      headers: { "content-type": "video/mp4" },
    });
  });
  return {
    config,
    backend,
    jobs,
    generate: new YfAssetGenerateService(config, backend, jobs, spend, fetchImpl, async () => {}),
  };
}

const videoBody = {
  model: "research.ltx",
  kind: "VIDEO_CLIP",
  role: "broll_sunrise",
  input: {
    projectId: "proj_1",
    kind: "VIDEO_CLIP",
    role: "broll_sunrise",
    creativeHints: { scenePurpose: "Gold light on the porch." },
    projectIntent: { purpose: "Birthday weekend", mood: "joyful" },
    effectiveBrief: { visualStyle: "handheld warmth" },
  },
};

describe("YfAssetGenerateService", () => {
  it("returns YouFlicks bytes + job id and persists only normalized metadata", async () => {
    const { generate, jobs, backend } = service();
    const result = await generate.generate(videoBody);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected generate success");
    }
    expect(result.body.mimeType).toBe("video/mp4");
    expect(Buffer.from(result.body.bytesBase64, "base64").toString("utf8")).toBe("fake-mp4");
    expect(result.body.jobId).toMatch(/^yf_asset_/);
    expect(result.body).not.toHaveProperty("fal");
    expect(result.body).not.toHaveProperty("providerPayload");

    const stored = jobs.get(result.body.jobId!);
    expect(stored?.providerKey).toBe("http.asset");
    expect(stored?.capability).toBe(AssetCapability.VIDEO_GENERATION);
    expect(stored?.modelId).toBe("research.ltx");
    expect(stored?.assetUrl).toBe("https://example.test/generated/clip.mp4");
    expect(stored).not.toHaveProperty("rawHost");
    expect(JSON.stringify(stored)).not.toContain("IN_QUEUE");
    expect(backend.requests.size).toBe(1);
  });

  it("fails closed without a gateway key", async () => {
    const { generate } = service({ YF_GATEWAY_API_KEY: "" });
    const result = await generate.generate(videoBody);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected fail-closed");
    }
    expect(result.status).toBe(503);
    expect(result.body.code).toBe("GATEWAY_NOT_CONFIGURED");
  });

  it("refuses VOICE/MUSIC/SFX instead of faking them", async () => {
    const { generate } = service();
    for (const kind of ["VOICE_OVER", "MUSIC", "SFX"] as const) {
      const result = await generate.generate({ ...videoBody, kind });
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected capability refusal");
      }
      expect(result.status).toBe(503);
      expect(result.body.code).toBe("ASSET_CAPABILITY_UNAVAILABLE");
    }
  });

  it("uses the request model so swapping ASSET_HTTP_MODEL needs no code change", async () => {
    const { generate, jobs } = service();
    const result = await generate.generate({ ...videoBody, model: "other/open-string-model" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected generate success");
    }
    expect(result.body.jobId).toBeTruthy();
    expect(jobs.get(result.body.jobId ?? "")?.modelId).toBe("other/open-string-model");
  });

  it("honors spend caps without writing cost into the generate bytes", async () => {
    const { generate } = service({
      YF_GATEWAY_MAX_JOBS: "1",
      YF_GATEWAY_ESTIMATED_USD_PER_JOB: "0.4",
    });
    const first = await generate.generate(videoBody);
    expect(first.ok).toBe(true);
    const second = await generate.generate(videoBody);
    expect(second.ok).toBe(false);
    if (second.ok) {
      throw new Error("expected spend cap");
    }
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("GATEWAY_SPEND_CAP");
    expect(first.body).not.toHaveProperty("estimatedCostUsd");
  });

  it("maps a backend webhook to the YouFlicks job without keeping vendor JSON", async () => {
    const { generate, jobs, backend } = service();
    const submitted = await backend.submit({
      model: "research.ltx",
      prompt: "test",
      extra: {},
    });
    const job = jobs.create({
      providerKey: "http.asset",
      capability: AssetCapability.VIDEO_GENERATION,
      modelId: "research.ltx",
      estimatedCostUsd: 0.5,
    });
    jobs.bindBackendRequest(job.jobId, submitted.backendRequestId);
    const accepted = generate.acceptWebhook({
      request_id: submitted.backendRequestId,
      status: "OK",
      payload: { video: { url: "https://example.test/generated/from-webhook.mp4" } },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.jobId).toBe(job.jobId);
    const stored = jobs.get(job.jobId);
    expect(stored?.assetUrl).toBe("https://example.test/generated/from-webhook.mp4");
    expect(stored).not.toHaveProperty("payload");
    expect(JSON.stringify(stored)).not.toContain("request_id");
  });
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("YfAssetGenerateService replicate transport", () => {
  it("speaks /v1/generate and returns YouFlicks bytes with open providerKey provenance", async () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "replicate",
      REPLICATE_API_TOKEN: "r8_recorded_token",
      YF_GATEWAY_PROVIDER_KEY: "replicate:wan-video/wan-2.7-i2v",
      YF_GATEWAY_POLL_MS: "1",
      YF_GATEWAY_MAX_JOBS: "2",
      YF_GATEWAY_MAX_SPEND_USD: "5",
      YF_GATEWAY_BACKEND_INPUT_JSON: JSON.stringify({
        imageBytesBase64: PNG_1X1.toString("base64"),
      }),
    });
    const backend = new ReplicateVideoBackend(config, createRecordedReplicateFetch());
    const jobs = new GatewayJobStore();
    const spend = new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob);
    const generate = new YfAssetGenerateService(
      config,
      backend,
      jobs,
      spend,
      createRecordedReplicateFetch(),
      async () => {},
    );

    const result = await generate.generate({
      model: "wan-video/wan-2.7-i2v",
      kind: "VIDEO_CLIP",
      role: "broll_clip",
      input: {
        projectId: "proj_1",
        kind: "VIDEO_CLIP",
        role: "broll_clip",
        creativeHints: { scenePurpose: "Gold light on the porch." },
        projectIntent: { purpose: "Birthday weekend", mood: "joyful" },
        effectiveBrief: { visualStyle: "handheld warmth" },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected replicate generate success");
    }
    expect(result.body.mimeType).toBe("video/mp4");
    expect(Buffer.from(result.body.bytesBase64, "base64").equals(RECORDED_WAN_VIDEO_BYTES)).toBe(
      true,
    );
    expect(result.body).not.toHaveProperty("replicate");
    expect(result.body).not.toHaveProperty("first_frame");
    const stored = jobs.get(result.body.jobId!);
    expect(stored?.providerKey).toBe("replicate:wan-video/wan-2.7-i2v");
    expect(stored?.capability).toBe(AssetCapability.VIDEO_GENERATION);
    expect(stored?.modelId).toBe("wan-video/wan-2.7-i2v");
    expect(JSON.stringify(stored)).not.toContain("catbox");
  });

  it("honors spend caps on the replicate transport without writing cost into bytes", async () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "replicate",
      REPLICATE_API_TOKEN: "r8_recorded_token",
      YF_GATEWAY_POLL_MS: "1",
      YF_GATEWAY_MAX_JOBS: "1",
      YF_GATEWAY_ESTIMATED_USD_PER_JOB: "0.4",
      YF_GATEWAY_BACKEND_INPUT_JSON: JSON.stringify({
        imageBytesBase64: PNG_1X1.toString("base64"),
      }),
    });
    const fetchImpl = createRecordedReplicateFetch();
    const generate = new YfAssetGenerateService(
      config,
      new ReplicateVideoBackend(config, fetchImpl),
      new GatewayJobStore(),
      new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob),
      fetchImpl,
      async () => {},
    );
    const first = await generate.generate({
      ...videoBody,
      model: "wan-video/wan-2.7-i2v",
    });
    expect(first.ok).toBe(true);
    const second = await generate.generate({
      ...videoBody,
      model: "wan-video/wan-2.7-i2v",
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      throw new Error("expected spend cap");
    }
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("GATEWAY_SPEND_CAP");
    expect(first.body).not.toHaveProperty("estimatedCostUsd");
  });
});
