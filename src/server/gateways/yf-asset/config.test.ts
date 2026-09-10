import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertGatewaySecrets,
  gatewayReady,
  parseYfAssetGatewayConfig,
} from "@/server/gateways/yf-asset/config";
import { AssetCapability } from "@/server/ports/capabilities";

describe("parseYfAssetGatewayConfig", () => {
  it("defaults to fal queue paths and VIDEO_GENERATION only", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
    });
    expect(config.backend).toBe("fal");
    expect(config.backendBaseUrl).toBe("https://queue.fal.run");
    expect(config.backendAuthScheme).toBe("Key");
    expect(config.webhookQueryParam).toBe("fal_webhook");
    expect(config.model).toBe("fal-ai/ltx-video");
    expect(config.providerKey).toBe("http.asset");
    expect(config.capabilities).toEqual([AssetCapability.VIDEO_GENERATION]);
  });

  it("accepts FAL_KEY as the backend secret alias without putting fal in domain env", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      FAL_KEY: "fal-secret",
    });
    expect(config.backendApiKey).toBe("fal-secret");
  });

  it("swaps model and backend host from env without code change", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "other-key",
      YF_GATEWAY_BACKEND: "http",
      YF_GATEWAY_BACKEND_BASE_URL: "https://queue.other.test",
      YF_GATEWAY_BACKEND_AUTH_SCHEME: "Bearer",
      YF_GATEWAY_MODEL: "other/open-string-model",
      YF_GATEWAY_PROVIDER_KEY: "research.video",
    });
    expect(config.backend).toBe("http");
    expect(config.backendBaseUrl).toBe("https://queue.other.test");
    expect(config.model).toBe("other/open-string-model");
    expect(config.providerKey).toBe("research.video");
  });
});

describe("assertGatewaySecrets", () => {
  it("fails closed when the gateway shared key is missing", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
    });
    expect(gatewayReady(config)).toBe(false);
    expect(() => assertGatewaySecrets(config)).toThrow(/YF_GATEWAY_API_KEY/);
  });

  it("fails closed when a real backend has no key", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "fal",
    });
    expect(gatewayReady(config)).toBe(false);
    expect(() => assertGatewaySecrets(config)).toThrow(/YF_GATEWAY_BACKEND_API_KEY/);
  });

  it("allows mock backend without a vendor key", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "mock",
      YF_GATEWAY_MODEL: "mock.video",
    });
    expect(() => assertGatewaySecrets(config)).not.toThrow();
    expect(gatewayReady(config)).toBe(true);
  });
});

describe("Prisma vendor neutrality", () => {
  it("does not add vendor enums for fal, Kling, Runway, OpenAI, or ElevenLabs", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).not.toMatch(/\benum\s+\w*(Fal|Kling|Runway|OpenAI|ElevenLabs|Eleven)\b/i);
    expect(schema).not.toMatch(/providerKey\s+String\s+@default\("(fal|kling|runway|openai|eleven)/i);
  });
});
