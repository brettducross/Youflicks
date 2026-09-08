import { env } from "@/lib/env";
import type { StoryExecutionAttribution } from "@/server/adapters/story/attribution";
import { HttpStoryComposerAdapter } from "@/server/adapters/story/http-story";
import { LocalDeterministicStoryComposer } from "@/server/adapters/story/local-deterministic";
import type { StoryComposerPort } from "@/server/ports/story-composer";

export type ResolvedStoryComposer = {
  adapter: StoryComposerPort;
  attribution: StoryExecutionAttribution;
  /** Genuine production adapter with credentials. */
  productionAvailable: boolean;
  /** Explicit local/dev adapter only — never production. */
  localDevAvailable: boolean;
};

/**
 * Local deterministic story composer is allowed only outside production,
 * and only when explicitly opted in.
 */
export function isLocalStoryComposerAllowed(
  nodeEnv: string = env.NODE_ENV,
  allowLocal: boolean = Boolean(env.STORY_ALLOW_LOCAL),
) {
  return allowLocal && nodeEnv !== "production";
}

/**
 * Resolve the story composer adapter for this process.
 * Local deterministic is never treated as production availability
 * and cannot be enabled when NODE_ENV is production.
 */
export function resolveStoryComposerAdapter(): ResolvedStoryComposer | null {
  const http = new HttpStoryComposerAdapter({
    providerKey: env.STORY_HTTP_PROVIDER_KEY,
    baseUrl: env.STORY_HTTP_BASE_URL,
    apiKey: env.STORY_HTTP_API_KEY,
    model: env.STORY_HTTP_MODEL,
    timeoutMs: env.STORY_HTTP_TIMEOUT_MS,
  });

  if (http.configured) {
    return {
      adapter: http,
      attribution: http.executionAttribution(),
      productionAvailable: true,
      localDevAvailable: false,
    };
  }

  if (isLocalStoryComposerAllowed()) {
    const local = new LocalDeterministicStoryComposer();
    return {
      adapter: local,
      attribution: local.executionAttribution(),
      productionAvailable: false,
      localDevAvailable: true,
    };
  }

  return null;
}

export function isProductionStoryAvailable() {
  return Boolean(resolveStoryComposerAdapter()?.productionAvailable);
}
