import { describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { registerConfiguredAdapters } from "@/server/analysis/provider-config";
import { ProviderRegistry } from "@/server/analysis/registry";
import { AnalysisCapability } from "@/server/ports/capabilities";
import type { StoragePort } from "@/server/ports/storage";

function memoryStorage(): StoragePort {
  return {
    driver: "memory",
    async put() {
      return { key: "x", contentType: "image/png", byteSize: 1 };
    },
    async get() {
      return null;
    },
    async getStream() {
      return null;
    },
    async delete() {},
    async exists() {
      return false;
    },
  };
}

describe("registerConfiguredAdapters", () => {
  it("registers the local technical adapter and the HTTP vision adapter", () => {
    const registry = registerConfiguredAdapters(new ProviderRegistry(), memoryStorage());
    const keys = registry.list().map((adapter) => adapter.providerKey);
    expect(keys).toContain("youflicks.local.technical");
    expect(keys).toContain(env.ANALYSIS_HTTP_PROVIDER_KEY);
  });

  it("never puts secrets on adapter health", () => {
    const registry = registerConfiguredAdapters(new ProviderRegistry(), memoryStorage());
    const serialized = JSON.stringify(registry.list().map((adapter) => adapter.health()));
    expect(serialized).not.toMatch(/apiKey|authorization|Bearer /i);
    expect(serialized).not.toContain("ANALYSIS_HTTP_API_KEY");
  });

  it("does not claim audio, transcription, or embeddings on the HTTP adapter", () => {
    const registry = registerConfiguredAdapters(new ProviderRegistry(), memoryStorage());
    const http = registry.get(env.ANALYSIS_HTTP_PROVIDER_KEY);
    expect(http?.capabilities).toEqual([
      AnalysisCapability.IMAGE_ANALYSIS,
      AnalysisCapability.VISION,
      AnalysisCapability.VIDEO_ANALYSIS,
    ]);
    expect(registry.listForCapability(AnalysisCapability.AUDIO_ANALYSIS)).toEqual([]);
    expect(registry.listForCapability(AnalysisCapability.TRANSCRIPTION)).toEqual([]);
    expect(registry.listForCapability(AnalysisCapability.EMBEDDINGS)).toEqual([]);
  });
});
