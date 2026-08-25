import { capabilityForKind } from "@/server/analysis/required-capability";
import { AnalysisCapability } from "@/server/ports/capabilities";
import type {
  AdapterAnalyzeResult,
  MediaAnalysisAdapter,
} from "@/server/ports/media-analysis-adapter";
import type { AnalyzeMediaInput } from "@/server/ports/media-analyzer";

/**
 * First-party adapter. Copies known ingest metadata into the technical
 * section. Not a commercial AI vendor. Visual/people/audio stay absent.
 */
export class LocalTechnicalAnalyzer implements MediaAnalysisAdapter {
  readonly providerKey = "youflicks.local.technical";
  readonly capabilities = [
    AnalysisCapability.IMAGE_ANALYSIS,
    AnalysisCapability.VIDEO_ANALYSIS,
  ] as const;
  readonly configured = true;
  readonly enabled = true;
  readonly routing = {
    quality: 0.2,
    cost: 0,
    latency: 1,
    reliability: 1,
    qualityTier: "low" as const,
    estimatedCost: 0,
    estimatedLatency: 5,
  };

  health() {
    return {
      providerKey: this.providerKey,
      configured: this.configured,
      enabled: this.enabled,
      available: true,
      capabilities: this.capabilities,
      routing: this.routing,
    };
  }

  async analyze(input: AnalyzeMediaInput): Promise<AdapterAnalyzeResult> {
    capabilityForKind(input.kind);
    const orientation =
      input.width && input.height
        ? input.width === input.height
          ? "square"
          : input.width > input.height
            ? "landscape"
            : "portrait"
        : undefined;

    return {
      providerKey: this.providerKey,
      modelId: "metadata-v1",
      modelVersion: "1.0",
      observations: {
        technical: {
          mediaType: input.kind,
          mimeType: input.mimeType,
          width: input.width,
          height: input.height,
          durationMs: input.durationMs,
          orientation,
          byteSize: input.byteSize,
        },
      },
    };
  }
}
