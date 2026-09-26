import type { AssetExecutionAttribution } from "@/server/adapters/assets/attribution";
import { HttpAssetGeneratorAdapter } from "@/server/adapters/assets/http-asset";
import type { ResolvedAssetGenerator } from "@/server/assets/provider-config";
import { AssetCapability, type AssetCapabilityValue } from "@/server/ports/capabilities";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { StoragePort } from "@/server/ports/storage";
import {
  isTbdProviderKey,
  type RegistryLane,
  type RegistryProcessor,
  type SgLaneRegistry,
} from "@/server/sg/lane-registry";

/**
 * SG.7 multi-lane resolver (PR-7).
 *
 * One app process holds one HttpAssetGeneratorAdapter per resolvable lane.
 * The lane is whichever instance the caller uses. AssetGeneratorPort and
 * AssetGeneratorInput are unchanged — there is no lane or model field on
 * the input.
 *
 * Each adapter is configured from that lane's registry gateway env names,
 * modelId, and providerKey. Attribution reports that pair. A process-level
 * ASSET_HTTP_MODEL / ASSET_HTTP_PROVIDER_KEY override is not copied onto
 * the lane, which is the gap where a per-request model kept a gateway-level
 * providerKey.
 *
 * Gateway processes stay single-lane. Each enabled lane is still identified
 * by YF_GATEWAY_LANE_ID on its own gateway process. This module does not
 * rewrite the gateway. The shipped LEGACY_R1 row names ASSET_HTTP_BASE_URL
 * and ASSET_HTTP_API_KEY, so the legacy config maps to that lane.
 *
 * processors() is the MEDIA_ENHANCEMENT hook only. The Ken Burns processor
 * is PR-9 and is not implemented here.
 * Routing, regen, and the LEGACY/ENFORCED flag are PR-8. Suspension does
 * not block resolution.
 */

/** Generative lanes advertise video only. Enhancement is the processor hook. */
const GENERATIVE_LANE_CAPABILITIES: readonly AssetCapabilityValue[] = [
  AssetCapability.VIDEO_GENERATION,
];

const DEFAULT_TIMEOUT_MS = 90_000;

export class LaneResolverError extends Error {
  readonly code = "LANE_NOT_RESOLVABLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "LaneResolverError";
  }
}

export type ResolvedLaneGenerator = {
  adapter: AssetGeneratorPort;
  attribution(capability: AssetCapabilityValue): AssetExecutionAttribution;
  supportedCapabilities: readonly AssetCapabilityValue[];
};

/**
 * PR-9 installs the processor adapter. Until then `adapter` stays null so
 * availability cannot claim MEDIA_ENHANCEMENT is ready.
 */
export type EnhancementProcessorHook = {
  laneId: string;
  providerKey: string;
  modelId: string;
  capability: AssetCapabilityValue;
  adapter: AssetGeneratorPort | null;
};

export type AssetLaneResolver = {
  forLane(laneId: string): ResolvedLaneGenerator;
  processors(capability: AssetCapabilityValue): EnhancementProcessorHook[];
};

export type ResolveAssetGeneratorLanesOptions = {
  /**
   * Env bag keyed by the registry's env var names.
   * When omitted, process.env is read at resolve time.
   * When provided, it is the whole bag — missing names are unset.
   */
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function resolveAssetGeneratorLanes(
  storage: StoragePort,
  registry: SgLaneRegistry,
  options: ResolveAssetGeneratorLanesOptions = {},
): AssetLaneResolver {
  const env = options.env ?? process.env;
  const timeoutMs = readTimeoutMs(env, options.timeoutMs);
  const cache = new Map<string, ResolvedLaneGenerator>();

  return {
    forLane(laneId: string) {
      const id = laneId.trim();
      const lane = registry.lanes.find((item) => item.laneId === id);
      if (!lane) {
        throw new LaneResolverError(
          `Lane ${id || "(empty)"} is not a generative registry lane and cannot be resolved.`,
        );
      }
      const cached = cache.get(lane.laneId);
      if (cached) {
        return cached;
      }
      const resolved = buildLaneAdapter(storage, lane, env, timeoutMs, options.fetchImpl);
      cache.set(lane.laneId, resolved);
      return resolved;
    },
    processors(capability: AssetCapabilityValue) {
      if (capability !== AssetCapability.MEDIA_ENHANCEMENT) {
        return [];
      }
      return registry.processors.filter(processorIsListed).map(toProcessorHook);
    },
  };
}

/**
 * Input for describeAssetAvailability. A capability is listed only when a
 * resolved adapter supports it. Processor hooks with a null adapter do not
 * advertise MEDIA_ENHANCEMENT. Local deterministic is never a lane.
 */
export function resolvedAssetGeneratorForLanes(
  lanes: readonly ResolvedLaneGenerator[],
  processors: readonly EnhancementProcessorHook[] = [],
): ResolvedAssetGenerator | null {
  const supported = new Set<AssetCapabilityValue>();
  for (const lane of lanes) {
    for (const capability of lane.supportedCapabilities) {
      supported.add(capability);
    }
  }
  for (const processor of processors) {
    if (processor.adapter) {
      supported.add(processor.capability);
    }
  }
  const adapter =
    lanes[0]?.adapter ?? processors.find((processor) => processor.adapter)?.adapter ?? null;
  if (!adapter || supported.size === 0) {
    return null;
  }
  const attributionSource = lanes[0];
  return {
    adapter,
    attributionFor: (capability) =>
      attributionSource
        ? attributionSource.attribution(capability)
        : {
            providerKey: "none",
            capability,
            modelId: null,
            modelVersion: null,
          },
    productionAvailable: true,
    localDevAvailable: false,
    supportedCapabilities: [...supported],
  };
}

function buildLaneAdapter(
  storage: StoragePort,
  lane: RegistryLane,
  env: Record<string, string | undefined>,
  timeoutMs: number,
  fetchImpl: typeof fetch | undefined,
): ResolvedLaneGenerator {
  if (isTbdProviderKey(lane.providerKey)) {
    throw new LaneResolverError(
      `Lane ${lane.laneId} has a TBD providerKey and cannot be resolved.`,
    );
  }
  if (!lane.enabled) {
    throw new LaneResolverError(`Lane ${lane.laneId} is disabled and cannot be resolved.`);
  }
  if (!(lane.usdPerSecond > 0)) {
    throw new LaneResolverError(
      `Lane ${lane.laneId} has no positive usdPerSecond and cannot be resolved.`,
    );
  }
  const baseUrl = readNamedEnv(env, lane.gateway.baseUrlEnv);
  if (!baseUrl) {
    throw new LaneResolverError(
      `Lane ${lane.laneId} is missing gateway env ${lane.gateway.baseUrlEnv} and cannot be resolved.`,
    );
  }
  const apiKey = readNamedEnv(env, lane.gateway.apiKeyEnv);
  if (!apiKey) {
    throw new LaneResolverError(
      `Lane ${lane.laneId} is missing gateway env ${lane.gateway.apiKeyEnv} and cannot be resolved.`,
    );
  }

  const config = {
    providerKey: lane.providerKey,
    baseUrl,
    apiKey,
    model: lane.modelId,
    timeoutMs,
    capabilities: [...GENERATIVE_LANE_CAPABILITIES],
  };
  const adapter = fetchImpl
    ? new HttpAssetGeneratorAdapter(storage, config, fetchImpl)
    : new HttpAssetGeneratorAdapter(storage, config);

  return {
    adapter,
    supportedCapabilities: GENERATIVE_LANE_CAPABILITIES,
    attribution(capability: AssetCapabilityValue): AssetExecutionAttribution {
      return {
        providerKey: lane.providerKey,
        capability,
        modelId: lane.modelId,
        modelVersion: null,
      };
    },
  };
}

function processorIsListed(processor: RegistryProcessor): boolean {
  return processor.enabled && !isTbdProviderKey(processor.providerKey);
}

function toProcessorHook(processor: RegistryProcessor): EnhancementProcessorHook {
  return {
    laneId: processor.laneId,
    providerKey: processor.providerKey,
    modelId: processor.modelId,
    capability: AssetCapability.MEDIA_ENHANCEMENT,
    adapter: null,
  };
}

function readNamedEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readTimeoutMs(env: Record<string, string | undefined>, override: number | undefined): number {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override <= 0) {
      throw new LaneResolverError("timeoutMs must be a positive integer.");
    }
    return override;
  }
  const raw = readNamedEnv(env, "ASSET_HTTP_TIMEOUT_MS");
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return value;
}
