import type { AssetExecutionAttribution } from "@/server/adapters/assets/attribution";
import { HttpAssetGeneratorAdapter } from "@/server/adapters/assets/http-asset";
import type {
  AssetAvailability,
  AssetCapabilityAvailability,
} from "@/server/assets/provider-config";
import {
  ALL_ASSET_CAPABILITIES,
  AssetCapability,
  type AssetCapabilityValue,
} from "@/server/ports/capabilities";
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
 * and ASSET_HTTP_API_KEY, so the legacy config maps to that lane. Any other
 * lane must name SG_LANE_* env vars. A resolved baseUrl must be http or https.
 *
 * processors() is the MEDIA_ENHANCEMENT hook only. The Ken Burns processor
 * is PR-9 and is not implemented here.
 * forLane does not apply eligibility, health, ceilings, or budget. AssetService
 * calls it only after those checks, and only for an ENFORCED GENERATE lane.
 * Suspension does not block resolution.
 */

/** Generative lanes advertise video only. Enhancement is the processor hook. */
const GENERATIVE_LANE_CAPABILITIES: readonly AssetCapabilityValue[] = [
  AssetCapability.VIDEO_GENERATION,
];

const DEFAULT_TIMEOUT_MS = 90_000;
const LEGACY_BASE_URL_ENV = "ASSET_HTTP_BASE_URL";
const LEGACY_API_KEY_ENV = "ASSET_HTTP_API_KEY";
const LANE_BASE_URL_ENV = /^SG_LANE_[A-Z0-9_]+_BASE_URL$/;
const LANE_API_KEY_ENV = /^SG_LANE_[A-Z0-9_]+_API_KEY$/;
const TIMEOUT_ENV = "ASSET_HTTP_TIMEOUT_MS";

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
 * Availability only. A capability is listed when a resolved lane supports it,
 * or when a processor hook has a non-null adapter. This is not a generation
 * path and not an attribution source: it returns no adapter and no providerKey.
 * Local deterministic is never a lane.
 */
export function resolvedAssetGeneratorForLanes(
  lanes: readonly ResolvedLaneGenerator[],
  processors: readonly EnhancementProcessorHook[] = [],
): AssetAvailability {
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
  const productionAvailable = supported.size > 0;
  const capabilities = Object.fromEntries(
    ALL_ASSET_CAPABILITIES.map((capability) => {
      const listed = supported.has(capability);
      return [
        capability,
        {
          productionAvailable: productionAvailable && listed,
          localDevAvailable: false,
          canGenerate: productionAvailable && listed,
        } satisfies AssetCapabilityAvailability,
      ];
    }),
  ) as Record<AssetCapabilityValue, AssetCapabilityAvailability>;
  return {
    productionAvailable,
    localDevAvailable: false,
    canGenerate: productionAvailable,
    capabilities,
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
  assertGatewayEnvNames(lane);
  const baseUrl = readNamedEnv(env, lane.gateway.baseUrlEnv);
  if (!baseUrl) {
    throw new LaneResolverError(
      `Lane ${lane.laneId} is missing gateway env ${lane.gateway.baseUrlEnv} and cannot be resolved.`,
    );
  }
  assertHttpBaseUrl(lane.laneId, lane.gateway.baseUrlEnv, baseUrl);
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

function assertGatewayEnvNames(lane: RegistryLane): void {
  const baseUrlEnv = lane.gateway.baseUrlEnv;
  const apiKeyEnv = lane.gateway.apiKeyEnv;
  if (baseUrlEnv !== LEGACY_BASE_URL_ENV && !LANE_BASE_URL_ENV.test(baseUrlEnv)) {
    throw new LaneResolverError(
      `Lane ${lane.laneId} gateway env ${baseUrlEnv} is not an allowed lane env name and cannot be resolved.`,
    );
  }
  if (apiKeyEnv !== LEGACY_API_KEY_ENV && !LANE_API_KEY_ENV.test(apiKeyEnv)) {
    throw new LaneResolverError(
      `Lane ${lane.laneId} gateway env ${apiKeyEnv} is not an allowed lane env name and cannot be resolved.`,
    );
  }
  const legacyBase = baseUrlEnv === LEGACY_BASE_URL_ENV;
  const legacyKey = apiKeyEnv === LEGACY_API_KEY_ENV;
  if ((legacyBase || legacyKey) && (lane.designation !== "LEGACY_R1" || !legacyBase || !legacyKey)) {
    throw new LaneResolverError(
      `Lane ${lane.laneId} gateway env ${baseUrlEnv} and ${apiKeyEnv} are not allowed for designation ${lane.designation} and cannot be resolved.`,
    );
  }
}

function assertHttpBaseUrl(laneId: string, envName: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new LaneResolverError(
      `Lane ${laneId} gateway env ${envName} is not an http(s) URL and cannot be resolved.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new LaneResolverError(
      `Lane ${laneId} gateway env ${envName} is not an http(s) URL and cannot be resolved.`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new LaneResolverError(
      `Lane ${laneId} gateway env ${envName} must not include a username or password and cannot be resolved.`,
    );
  }
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
  const raw = env[TIMEOUT_ENV];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new LaneResolverError(`${TIMEOUT_ENV} must be a positive integer.`);
  }
  return value;
}
