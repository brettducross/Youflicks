import { env } from "@/lib/env";
import { HttpVisionAdapter } from "@/server/adapters/analysis/http-vision";
import { LocalTechnicalAnalyzer } from "@/server/adapters/analysis/local-technical";
import { ProviderRegistry } from "@/server/analysis/registry";
import type { MediaAnalysisAdapter } from "@/server/ports/media-analysis-adapter";
import type { StoragePort } from "@/server/ports/storage";

export function createAnalysisAdapters(storage: StoragePort): MediaAnalysisAdapter[] {
  return [
    new LocalTechnicalAnalyzer(),
    new HttpVisionAdapter(storage, {
      providerKey: env.ANALYSIS_HTTP_PROVIDER_KEY,
      baseUrl: env.ANALYSIS_HTTP_BASE_URL,
      apiKey: env.ANALYSIS_HTTP_API_KEY,
      model: env.ANALYSIS_HTTP_MODEL,
      timeoutMs: env.ANALYSIS_HTTP_TIMEOUT_MS,
    }),
  ];
}

export function registerConfiguredAdapters(registry: ProviderRegistry, storage: StoragePort) {
  for (const adapter of createAnalysisAdapters(storage)) {
    registry.register(adapter);
  }
  return registry;
}

export function providerHealthList(registry: ProviderRegistry) {
  return registry.list().map((adapter) => adapter.health());
}
