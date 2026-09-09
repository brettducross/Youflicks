import { env } from "@/lib/env";
import type { TimelineExecutionAttribution } from "@/server/adapters/timeline/attribution";
import { HttpTimelineComposerAdapter } from "@/server/adapters/timeline/http-timeline";
import { LocalDeterministicTimelineComposer } from "@/server/adapters/timeline/local-deterministic";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";

export type ResolvedTimelineComposer = {
  adapter: TimelineComposerPort;
  attribution: TimelineExecutionAttribution;
  /** Genuine production adapter with credentials. */
  productionAvailable: boolean;
  /** Explicit local/dev adapter only — never production. */
  localDevAvailable: boolean;
};

/**
 * Local deterministic timeline composer is allowed only outside production,
 * and only when explicitly opted in.
 */
export function isLocalTimelineComposerAllowed(
  nodeEnv: string = env.NODE_ENV,
  allowLocal: boolean = Boolean(env.TIMELINE_ALLOW_LOCAL),
) {
  return allowLocal && nodeEnv !== "production";
}

/**
 * Resolve the timeline composer adapter for this process.
 * Local deterministic is never treated as production availability
 * and cannot be enabled when NODE_ENV is production.
 */
export function resolveTimelineComposerAdapter(): ResolvedTimelineComposer | null {
  const http = new HttpTimelineComposerAdapter({
    providerKey: env.TIMELINE_HTTP_PROVIDER_KEY,
    baseUrl: env.TIMELINE_HTTP_BASE_URL,
    apiKey: env.TIMELINE_HTTP_API_KEY,
    model: env.TIMELINE_HTTP_MODEL,
    timeoutMs: env.TIMELINE_HTTP_TIMEOUT_MS,
  });

  if (http.configured) {
    return {
      adapter: http,
      attribution: http.executionAttribution(),
      productionAvailable: true,
      localDevAvailable: false,
    };
  }

  if (isLocalTimelineComposerAllowed()) {
    const local = new LocalDeterministicTimelineComposer();
    return {
      adapter: local,
      attribution: local.executionAttribution(),
      productionAvailable: false,
      localDevAvailable: true,
    };
  }

  return null;
}

export function isProductionTimelineAvailable() {
  return Boolean(resolveTimelineComposerAdapter()?.productionAvailable);
}
