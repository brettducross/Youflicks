import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { normalizeAnalysisResult } from "@/server/analysis/normalize";
import { ProviderRegistry } from "@/server/analysis/registry";
import { capabilityForKind } from "@/server/analysis/required-capability";
import {
  PreferredThenFirstPolicy,
  type ProviderSelectionPolicy,
} from "@/server/analysis/selection";
import type {
  AnalyzeMediaInput,
  MediaAnalysisResult,
  MediaAnalyzerPort,
} from "@/server/ports/media-analyzer";

/**
 * Domain-facing analyzer. Selects an adapter by capability, calls it,
 * then normalizes. No vendor types cross this boundary.
 */
export class RegistryMediaAnalyzer implements MediaAnalyzerPort {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly policy: ProviderSelectionPolicy = new PreferredThenFirstPolicy(),
    private readonly preferredProviderKey: string | null = null,
  ) {}

  async analyze(input: AnalyzeMediaInput): Promise<MediaAnalysisResult> {
    const capability = input.requestedCapabilities[0] ?? capabilityForKind(input.kind);
    const adapter = this.policy.select(this.registry.list(), {
      capability,
      mediaKind: input.kind,
      preferredProviderKey: this.preferredProviderKey,
    });
    if (!adapter) {
      throw AppError.providerNotConfigured(`MediaAnalyzerPort:${capability}`);
    }

    logger.info("analysis.provider_selected", {
      providerKey: adapter.providerKey,
      capability,
      assetId: input.assetId,
      projectId: input.projectId,
    });

    let raw;
    try {
      raw = await adapter.analyze({
        ...input,
        requestedCapabilities: input.requestedCapabilities.length
          ? input.requestedCapabilities
          : [capability],
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw AppError.analysisFailed(
        error instanceof Error ? error.message : "The analysis adapter failed.",
      );
    }

    return normalizeAnalysisResult(raw);
  }
}
