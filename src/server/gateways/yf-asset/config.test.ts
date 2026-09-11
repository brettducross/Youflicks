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
    expect(config.maxJobs).toBeUndefined();
    expect(config.maxSpendUsd).toBeUndefined();
  });

  it("applies beta spend defaults for a live backend when caps are unset", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
      YF_GATEWAY_BACKEND: "replicate",
      REPLICATE_API_TOKEN: "r8_token",
    });
    expect(config.maxJobs).toBe(10);
    expect(config.maxSpendUsd).toBe(8);
    expect(() => assertGatewaySecrets(config)).not.toThrow();
  });

  it("fails closed when a webhook URL is set without a secret", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "mock",
      YF_GATEWAY_MODEL: "mock.video",
      YF_GATEWAY_WEBHOOK_URL: "https://example.test/hook",
    });
    expect(() => assertGatewaySecrets(config)).toThrow(/YF_GATEWAY_WEBHOOK_SECRET/);
  });
});

describe("live gateway durable ledger", () => {
  it("fails closed without DATABASE_URL when the backend is not mock", async () => {
    const { createYfAssetGatewayRuntime } = await import("@/server/gateways/yf-asset/server");
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() =>
        createYfAssetGatewayRuntime(
          parseYfAssetGatewayConfig({
            YF_GATEWAY_API_KEY: "gw-key",
            YF_GATEWAY_BACKEND_API_KEY: "backend-key",
            YF_GATEWAY_BACKEND: "http",
            YF_GATEWAY_MODEL: "open.model",
          }),
        ),
      ).toThrow(/DATABASE_URL/);
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
    }
  });
});

describe("Prisma vendor neutrality", () => {
  it("does not add vendor enums for fal, Kling, Runway, OpenAI, ElevenLabs, Replicate, or Wan", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).not.toMatch(
      /\benum\s+\w*(Fal|Kling|Runway|OpenAI|ElevenLabs|Eleven|Replicate|Wan)\b/i,
    );
    expect(schema).not.toMatch(
      /providerKey\s+String\s+@default\("(fal|kling|runway|openai|eleven|replicate|wan)/i,
    );
    expect(schema).toMatch(/providerKey\s+String/);
  });
});

describe("replicate transport config", () => {
  it("treats replicate as an alternate backend with open providerKey + model strings", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      REPLICATE_API_TOKEN: "r8_token",
      YF_GATEWAY_BACKEND: "replicate",
    });
    expect(config.backend).toBe("replicate");
    expect(config.backendBaseUrl).toBe("https://api.replicate.com");
    expect(config.backendAuthScheme).toBe("Bearer");
    expect(config.backendApiKey).toBe("r8_token");
    expect(config.model).toBe("wan-video/wan-2.7-i2v");
    expect(config.providerKey).toBe("replicate:wan-video/wan-2.7-i2v");
  });

  it("lets env swap the replicate model without code change", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      REPLICATE_API_TOKEN: "r8_token",
      YF_GATEWAY_BACKEND: "replicate",
      YF_GATEWAY_MODEL: "other/open-string-i2v",
      YF_GATEWAY_PROVIDER_KEY: "research.video",
    });
    expect(config.model).toBe("other/open-string-i2v");
    expect(config.providerKey).toBe("research.video");
  });

  it("fails closed when the replicate transport has no token", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND: "replicate",
    });
    expect(gatewayReady(config)).toBe(false);
    expect(() => assertGatewaySecrets(config)).toThrow(/REPLICATE_API_TOKEN/);
  });

  it("does not make replicate the default backend", () => {
    const config = parseYfAssetGatewayConfig({
      YF_GATEWAY_API_KEY: "gw-key",
      YF_GATEWAY_BACKEND_API_KEY: "backend-key",
    });
    expect(config.backend).toBe("fal");
    expect(config.providerKey).toBe("http.asset");
  });
});
