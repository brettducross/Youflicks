import {
  BETA_DEFAULT_MAX_JOBS,
  BETA_DEFAULT_MAX_SPEND_USD,
} from "@/server/beta/defaults";
import {
  ALL_ASSET_CAPABILITIES,
  AssetCapability,
  type AssetCapabilityValue,
} from "@/server/ports/capabilities";

export const YF_ASSET_GATEWAY_BACKENDS = ["fal", "http", "replicate", "mock"] as const;
export type YfAssetGatewayBackend = (typeof YF_ASSET_GATEWAY_BACKENDS)[number];

export class GatewayConfigError extends Error {
  readonly code = "GATEWAY_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "GatewayConfigError";
  }
}

export type YfAssetGatewayConfig = {
  listenHost: string;
  listenPort: number;
  apiKey?: string;
  providerKey: string;
  capabilities: AssetCapabilityValue[];
  backend: YfAssetGatewayBackend;
  backendBaseUrl: string;
  backendApiKey?: string;
  backendAuthScheme: string;
  webhookQueryParam: string;
  submitPath: string;
  statusPath: string;
  resultPath: string;
  model: string;
  imageModel?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  timeoutMs: number;
  pollMs: number;
  maxJobs?: number;
  maxSpendUsd?: number;
  estimatedUsdPerJob: number;
  downloadMaxBytes: number;
  extraInput: Record<string, unknown>;
};

const DEFAULT_FAL_BASE = "https://queue.fal.run";
const DEFAULT_FAL_MODEL = "fal-ai/ltx-video";
const DEFAULT_FAL_AUTH = "Key";
const DEFAULT_FAL_WEBHOOK_QUERY = "fal_webhook";
const DEFAULT_REPLICATE_BASE = "https://api.replicate.com";
/** Pilot example for the replicate transport — not a domain default. Swap via YF_GATEWAY_MODEL. */
const DEFAULT_REPLICATE_MODEL = "wan-video/wan-2.7-i2v";
const DEFAULT_SUBMIT_PATH = "/{model}";
const DEFAULT_STATUS_PATH = "/{model}/requests/{id}/status";
const DEFAULT_RESULT_PATH = "/{model}/requests/{id}";

/**
 * Gateway-process env only. Do not add these keys to the Next.js app schema —
 * vendor backend secrets stay off the domain process.
 */
export type GatewayEnv = Record<string, string | undefined>;

export function parseYfAssetGatewayConfig(
  env: GatewayEnv = process.env,
): YfAssetGatewayConfig {
  const backend = parseBackend(env.YF_GATEWAY_BACKEND);
  const falPreset = backend === "fal";
  const replicatePreset = backend === "replicate";
  const model =
    env.YF_GATEWAY_MODEL?.trim() ||
    (falPreset ? DEFAULT_FAL_MODEL : replicatePreset ? DEFAULT_REPLICATE_MODEL : "");
  const backendBaseUrl =
    emptyToUndefined(env.YF_GATEWAY_BACKEND_BASE_URL) ??
    (replicatePreset ? DEFAULT_REPLICATE_BASE : DEFAULT_FAL_BASE);
  const providerKey =
    env.YF_GATEWAY_PROVIDER_KEY?.trim() ||
    (replicatePreset && model ? `replicate:${model}` : "http.asset");
  return {
    listenHost: env.YF_GATEWAY_LISTEN_HOST?.trim() || "127.0.0.1",
    listenPort: positiveInt(env.YF_GATEWAY_LISTEN_PORT, 43148),
    apiKey: emptyToUndefined(env.YF_GATEWAY_API_KEY),
    providerKey,
    capabilities: parseCapabilities(env.YF_GATEWAY_CAPABILITIES),
    backend,
    backendBaseUrl,
    backendApiKey:
      emptyToUndefined(env.YF_GATEWAY_BACKEND_API_KEY) ??
      emptyToUndefined(env.FAL_KEY) ??
      emptyToUndefined(env.REPLICATE_API_TOKEN),
    backendAuthScheme:
      env.YF_GATEWAY_BACKEND_AUTH_SCHEME?.trim() || (falPreset ? DEFAULT_FAL_AUTH : "Bearer"),
    webhookQueryParam:
      env.YF_GATEWAY_WEBHOOK_QUERY?.trim() || (falPreset ? DEFAULT_FAL_WEBHOOK_QUERY : "webhook_url"),
    submitPath: env.YF_GATEWAY_SUBMIT_PATH?.trim() || DEFAULT_SUBMIT_PATH,
    statusPath: env.YF_GATEWAY_STATUS_PATH?.trim() || DEFAULT_STATUS_PATH,
    resultPath: env.YF_GATEWAY_RESULT_PATH?.trim() || DEFAULT_RESULT_PATH,
    model,
    imageModel: emptyToUndefined(env.YF_GATEWAY_IMAGE_MODEL),
    webhookUrl: emptyToUndefined(env.YF_GATEWAY_WEBHOOK_URL),
    webhookSecret: emptyToUndefined(env.YF_GATEWAY_WEBHOOK_SECRET),
    timeoutMs: positiveInt(env.YF_GATEWAY_TIMEOUT_MS, 300_000),
    pollMs: positiveInt(env.YF_GATEWAY_POLL_MS, 2_000),
    ...resolveLiveSpendCaps(backend, env),
    estimatedUsdPerJob: optionalPositiveNumber(env.YF_GATEWAY_ESTIMATED_USD_PER_JOB) ?? 0.5,
    downloadMaxBytes: positiveInt(env.YF_GATEWAY_DOWNLOAD_MAX_BYTES, 100 * 1024 * 1024),
    extraInput: parseExtraInput(env.YF_GATEWAY_BACKEND_INPUT_JSON),
  };
}

export function assertGatewaySecrets(config: YfAssetGatewayConfig): void {
  if (!config.apiKey) {
    throw new GatewayConfigError(
      "YF_GATEWAY_API_KEY is required. The YouFlicks asset gateway fails closed without a shared key.",
    );
  }
  if (config.backend !== "mock" && !config.backendApiKey) {
    throw new GatewayConfigError(
      config.backend === "replicate"
        ? "REPLICATE_API_TOKEN (or YF_GATEWAY_BACKEND_API_KEY) is required. The replicate transport fails closed without a token."
        : "YF_GATEWAY_BACKEND_API_KEY (or FAL_KEY for the fal preset) is required. The gateway fails closed without a backend key.",
    );
  }
  if (config.backend !== "mock") {
    if (config.maxJobs == null || config.maxSpendUsd == null) {
      throw new GatewayConfigError(
        "YF_GATEWAY_MAX_JOBS and YF_GATEWAY_MAX_SPEND_USD are required for a live gateway backend. Uncapped spend is fail-closed.",
      );
    }
  }
  if (config.webhookUrl && !config.webhookSecret) {
    throw new GatewayConfigError(
      "YF_GATEWAY_WEBHOOK_SECRET is required when YF_GATEWAY_WEBHOOK_URL is set. Webhooks fail closed without a shared secret.",
    );
  }
}

function resolveLiveSpendCaps(
  backend: YfAssetGatewayBackend,
  env: GatewayEnv,
): { maxJobs?: number; maxSpendUsd?: number } {
  const maxJobs = optionalPositiveInt(env.YF_GATEWAY_MAX_JOBS);
  const maxSpendUsd = optionalPositiveNumber(env.YF_GATEWAY_MAX_SPEND_USD);
  if (backend === "mock") {
    return { maxJobs, maxSpendUsd };
  }
  return {
    maxJobs: maxJobs ?? BETA_DEFAULT_MAX_JOBS,
    maxSpendUsd: maxSpendUsd ?? BETA_DEFAULT_MAX_SPEND_USD,
  };
}

export function gatewayReady(config: YfAssetGatewayConfig): boolean {
  try {
    assertGatewaySecrets(config);
    return config.model.trim().length > 0;
  } catch {
    return false;
  }
}

function parseBackend(raw: string | undefined): YfAssetGatewayBackend {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return "fal";
  }
  if ((YF_ASSET_GATEWAY_BACKENDS as readonly string[]).includes(value)) {
    return value as YfAssetGatewayBackend;
  }
  throw new GatewayConfigError(
    `YF_GATEWAY_BACKEND must be one of ${YF_ASSET_GATEWAY_BACKENDS.join(", ")}.`,
  );
}

function parseCapabilities(raw: string | undefined): AssetCapabilityValue[] {
  if (!raw || raw.trim() === "") {
    return [AssetCapability.VIDEO_GENERATION];
  }
  const allowed = new Set<string>(ALL_ASSET_CAPABILITIES);
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is AssetCapabilityValue => allowed.has(item));
  if (parsed.length === 0) {
    return [AssetCapability.VIDEO_GENERATION];
  }
  return parsed;
}

function parseExtraInput(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === "") {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    throw new GatewayConfigError("YF_GATEWAY_BACKEND_INPUT_JSON must be a JSON object.");
  }
  throw new GatewayConfigError("YF_GATEWAY_BACKEND_INPUT_JSON must be a JSON object.");
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function optionalPositiveInt(raw: string | undefined): number | undefined {
  if (!raw || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function optionalPositiveNumber(raw: string | undefined): number | undefined {
  if (!raw || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}
