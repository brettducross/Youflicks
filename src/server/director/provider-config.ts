import { env } from "@/lib/env";
import type { DirectorExecutionAttribution } from "@/server/adapters/director/attribution";
import { HttpDirectorAdapter } from "@/server/adapters/director/http-director";
import { LocalDeterministicDirector } from "@/server/adapters/director/local-deterministic";
import type { AiDirectorPort } from "@/server/ports/ai-director";

export type ResolvedDirector = {
  adapter: AiDirectorPort;
  attribution: DirectorExecutionAttribution;
  /** Genuine production adapter with credentials. */
  productionAvailable: boolean;
  /** Explicit local/dev adapter only — never production. */
  localDevAvailable: boolean;
};

/**
 * Local deterministic Director is allowed only outside production,
 * and only when explicitly opted in. Documentation alone is not enough.
 */
export function isLocalDirectorAllowed(
  nodeEnv: string = env.NODE_ENV,
  allowLocal: boolean = Boolean(env.DIRECTOR_ALLOW_LOCAL),
) {
  return allowLocal && nodeEnv !== "production";
}

/**
 * Resolve the Director adapter for this process.
 * Local deterministic is never treated as production availability
 * and cannot be enabled when NODE_ENV is production.
 */
export function resolveDirectorAdapter(): ResolvedDirector | null {
  const http = new HttpDirectorAdapter({
    providerKey: env.DIRECTOR_HTTP_PROVIDER_KEY,
    baseUrl: env.DIRECTOR_HTTP_BASE_URL,
    apiKey: env.DIRECTOR_HTTP_API_KEY,
    model: env.DIRECTOR_HTTP_MODEL,
    timeoutMs: env.DIRECTOR_HTTP_TIMEOUT_MS,
  });

  if (http.configured) {
    return {
      adapter: http,
      attribution: http.executionAttribution(),
      productionAvailable: true,
      localDevAvailable: false,
    };
  }

  if (isLocalDirectorAllowed()) {
    const local = new LocalDeterministicDirector();
    return {
      adapter: local,
      attribution: local.executionAttribution(),
      productionAvailable: false,
      localDevAvailable: true,
    };
  }

  return null;
}

export function isProductionDirectorAvailable() {
  return Boolean(resolveDirectorAdapter()?.productionAvailable);
}
