import { describe, expect, it } from "vitest";
import { ReplicateVideoBackend } from "@/server/gateways/yf-asset/backends/replicate";
import { parseYfAssetGatewayConfig } from "@/server/gateways/yf-asset/config";
import { YfAssetGenerateService } from "@/server/gateways/yf-asset/generate";
import { GatewayJobStore } from "@/server/gateways/yf-asset/jobs";
import { SpendGuard } from "@/server/gateways/yf-asset/spend";

const liveEnabled =
  process.env.YF_GATEWAY_LIVE_REPLICATE === "1" && Boolean(process.env.REPLICATE_API_TOKEN);

/**
 * Optional live spend. CI stays on recorded fixtures.
 * Run:
 *   YF_GATEWAY_LIVE_REPLICATE=1 REPLICATE_API_TOKEN=... \
 *   YF_GATEWAY_MAX_JOBS=1 YF_GATEWAY_MAX_SPEND_USD=2 \
 *   npm test -- src/server/gateways/yf-asset/replicate.live.test.ts
 */
describe.skipIf(!liveEnabled)("optional live Replicate I2V under spend caps", () => {
  it(
    "completes one wan-2.7-i2v job through the YouFlicks /v1/generate contract",
    async () => {
      const config = parseYfAssetGatewayConfig({
        YF_GATEWAY_API_KEY: "live-gw-key",
        YF_GATEWAY_BACKEND: "replicate",
        REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
        YF_GATEWAY_MODEL: process.env.YF_GATEWAY_MODEL || "wan-video/wan-2.7-i2v",
        YF_GATEWAY_PROVIDER_KEY: "replicate:wan-video/wan-2.7-i2v",
        YF_GATEWAY_MAX_JOBS: process.env.YF_GATEWAY_MAX_JOBS || "1",
        YF_GATEWAY_MAX_SPEND_USD: process.env.YF_GATEWAY_MAX_SPEND_USD || "2",
        YF_GATEWAY_TIMEOUT_MS: process.env.YF_GATEWAY_TIMEOUT_MS || "300000",
        YF_GATEWAY_POLL_MS: process.env.YF_GATEWAY_POLL_MS || "2000",
        YF_GATEWAY_BACKEND_INPUT_JSON: process.env.YF_GATEWAY_BACKEND_INPUT_JSON,
      });
      const generate = new YfAssetGenerateService(
        config,
        new ReplicateVideoBackend(config),
        new GatewayJobStore(),
        new SpendGuard(config.maxJobs, config.maxSpendUsd, config.estimatedUsdPerJob),
      );
      const result = await generate.generate({
        model: config.model,
        kind: "VIDEO_CLIP",
        role: "broll_clip",
        input: {
          kind: "VIDEO_CLIP",
          role: "broll_clip",
          creativeHints: { scenePurpose: "Gentle camera drift over a still porch at golden hour." },
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.body.error);
      }
      expect(result.body.mimeType).toMatch(/^video\//);
      expect(result.body.bytesBase64.length).toBeGreaterThan(100);
      expect(result.body.jobId).toMatch(/^yf_asset_/);
    },
    360_000,
  );
});
