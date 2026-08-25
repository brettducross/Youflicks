import { AppError } from "@/lib/errors";
import {
  ANALYSIS_SCHEMA_VERSION,
  mediaAnalysisDocumentSchema,
  type MediaAnalysisDocument,
} from "@/server/analysis/schema";
import type { AdapterAnalyzeResult } from "@/server/ports/media-analysis-adapter";
import type { AnalysisProvenance } from "@/server/ports/media-analyzer";

export type NormalizedAnalysis = {
  analysis: MediaAnalysisDocument;
  provenance: AnalysisProvenance;
};

/**
 * Provider-specific (or adapter) observations → YouFlicks-owned document.
 * Missing sections stay absent. Nothing is invented. Confidence is not fabricated.
 */
export function normalizeAnalysisResult(raw: AdapterAnalyzeResult): NormalizedAnalysis {
  if (!raw || typeof raw !== "object") {
    throw AppError.invalidAnalysis("Analyzer returned an empty result.");
  }
  if (!raw.providerKey || typeof raw.providerKey !== "string") {
    throw AppError.invalidAnalysis("Analyzer result is missing provider provenance.");
  }
  if (!raw.observations || typeof raw.observations !== "object" || Array.isArray(raw.observations)) {
    throw AppError.invalidAnalysis("Analyzer observations must be an object.");
  }

  const candidate = {
    ...raw.observations,
    analysisSchemaVersion: ANALYSIS_SCHEMA_VERSION,
  };

  const parsed = mediaAnalysisDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    throw AppError.invalidAnalysis("Analyzer output does not match the YouFlicks analysis schema.", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  return {
    analysis: parsed.data,
    provenance: {
      providerKey: raw.providerKey,
      modelId: raw.modelId ?? null,
      modelVersion: raw.modelVersion ?? null,
    },
  };
}
