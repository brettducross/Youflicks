import { env } from "@/lib/env";
import type { RenderExecutionAttribution } from "@/server/adapters/renderer/attribution";
import { HttpRendererAdapter } from "@/server/adapters/renderer/http-renderer";
import { LocalDeterministicRenderer } from "@/server/adapters/renderer/local-deterministic";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoragePort } from "@/server/ports/storage";

export type RenderAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canRender: boolean;
};

export type ResolvedRenderer = {
  adapter: RendererPort;
  attribution: RenderExecutionAttribution;
  productionAvailable: boolean;
  localDevAvailable: boolean;
};

/**
 * Local deterministic renderer is allowed only outside production,
 * and only when explicitly opted in.
 */
export function isLocalRendererAllowed(
  nodeEnv: string = env.NODE_ENV,
  allowLocal: boolean = Boolean(env.RENDER_ALLOW_LOCAL),
) {
  return allowLocal && nodeEnv !== "production";
}

/**
 * Resolve the renderer adapter for this process.
 * Local deterministic is never treated as production availability
 * and cannot be enabled when NODE_ENV is production.
 */
export function resolveRendererAdapter(storage: StoragePort): ResolvedRenderer | null {
  const http = new HttpRendererAdapter(storage, {
    providerKey: env.RENDER_HTTP_PROVIDER_KEY,
    baseUrl: env.RENDER_HTTP_BASE_URL,
    apiKey: env.RENDER_HTTP_API_KEY,
    model: env.RENDER_HTTP_MODEL,
    timeoutMs: env.RENDER_HTTP_TIMEOUT_MS,
  });

  if (http.configured) {
    return {
      adapter: http,
      attribution: http.executionAttribution(),
      productionAvailable: true,
      localDevAvailable: false,
    };
  }

  if (isLocalRendererAllowed()) {
    const local = new LocalDeterministicRenderer(storage);
    return {
      adapter: local,
      attribution: local.executionAttribution(),
      productionAvailable: false,
      localDevAvailable: true,
    };
  }

  return null;
}

export function describeRenderAvailability(resolved: ResolvedRenderer | null): RenderAvailability {
  return {
    productionAvailable: Boolean(resolved?.productionAvailable),
    localDevAvailable: Boolean(resolved?.localDevAvailable),
    canRender: Boolean(resolved),
  };
}

export function emptyRenderAvailability(): RenderAvailability {
  return describeRenderAvailability(null);
}
