import { env } from "@/lib/env";
import type { AssetExecutionAttribution } from "@/server/adapters/assets/attribution";
import { HttpAssetGeneratorAdapter } from "@/server/adapters/assets/http-asset";
import { LocalDeterministicAssetGenerator } from "@/server/adapters/assets/local-deterministic";
import {
  ALL_ASSET_CAPABILITIES,
  AssetCapability,
  type AssetCapabilityValue,
} from "@/server/ports/capabilities";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { StoragePort } from "@/server/ports/storage";

export type AssetCapabilityAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canGenerate: boolean;
};

export type AssetAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canGenerate: boolean;
  capabilities: Record<AssetCapabilityValue, AssetCapabilityAvailability>;
};

export type ResolvedAssetGenerator = {
  adapter: AssetGeneratorPort;
  attributionFor(capability: AssetCapabilityValue): AssetExecutionAttribution;
  productionAvailable: boolean;
  localDevAvailable: boolean;
  supportedCapabilities: AssetCapabilityValue[];
};

/**
 * Local deterministic asset generator is allowed only outside production,
 * and only when explicitly opted in.
 */
export function isLocalAssetGeneratorAllowed(
  nodeEnv: string = env.NODE_ENV,
  allowLocal: boolean = Boolean(env.ASSET_ALLOW_LOCAL),
) {
  return allowLocal && nodeEnv !== "production";
}

export function parseAssetHttpCapabilities(
  raw: string | undefined = env.ASSET_HTTP_CAPABILITIES,
): AssetCapabilityValue[] | undefined {
  if (!raw || raw.trim() === "") {
    return undefined;
  }
  const allowed = new Set<string>(ALL_ASSET_CAPABILITIES);
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is AssetCapabilityValue => allowed.has(item));
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * Resolve the asset generator adapter for this process.
 * Local deterministic is never treated as production availability
 * and cannot be enabled when NODE_ENV is production.
 * HTTP production path talks to a YouFlicks-shaped /v1/generate gateway
 * (ASSET_HTTP_*). The gateway may map to fal or another backend — the
 * domain never imports a vendor SDK.
 */
export function resolveAssetGeneratorAdapter(
  storage: StoragePort,
): ResolvedAssetGenerator | null {
  const http = new HttpAssetGeneratorAdapter(storage, {
    providerKey: env.ASSET_HTTP_PROVIDER_KEY,
    baseUrl: env.ASSET_HTTP_BASE_URL,
    apiKey: env.ASSET_HTTP_API_KEY,
    model: env.ASSET_HTTP_MODEL,
    timeoutMs: env.ASSET_HTTP_TIMEOUT_MS,
    capabilities: parseAssetHttpCapabilities(),
  });

  if (http.configured) {
    return {
      adapter: http,
      attributionFor: (capability) => http.executionAttribution(capability),
      productionAvailable: true,
      localDevAvailable: false,
      supportedCapabilities: http.supportedCapabilities(),
    };
  }

  if (isLocalAssetGeneratorAllowed()) {
    const local = new LocalDeterministicAssetGenerator(storage);
    return {
      adapter: local,
      attributionFor: (capability) => local.executionAttribution(capability),
      productionAvailable: false,
      localDevAvailable: true,
      supportedCapabilities: [...local.supportedCapabilities],
    };
  }

  return null;
}

export function describeAssetAvailability(resolved: ResolvedAssetGenerator | null): AssetAvailability {
  const capabilities = Object.fromEntries(
    ALL_ASSET_CAPABILITIES.map((capability) => {
      const supported = Boolean(resolved?.supportedCapabilities.includes(capability));
      const productionAvailable = Boolean(resolved?.productionAvailable && supported);
      const localDevAvailable = Boolean(resolved?.localDevAvailable && supported);
      return [
        capability,
        {
          productionAvailable,
          localDevAvailable,
          canGenerate: productionAvailable || localDevAvailable,
        } satisfies AssetCapabilityAvailability,
      ];
    }),
  ) as Record<AssetCapabilityValue, AssetCapabilityAvailability>;

  return {
    productionAvailable: Boolean(resolved?.productionAvailable),
    localDevAvailable: Boolean(resolved?.localDevAvailable),
    canGenerate: Boolean(resolved),
    capabilities,
  };
}

export function emptyAssetAvailability(): AssetAvailability {
  return describeAssetAvailability(null);
}

export { AssetCapability };
