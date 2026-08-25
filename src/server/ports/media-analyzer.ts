/**
 * Media analysis port — what YouFlicks wants done, not how a vendor does it.
 *
 * The domain calls this port and receives a YouFlicks-owned document.
 * It never sees vendor SDK types or raw provider JSON.
 */
import type { AnalysisCapabilityValue } from "@/server/ports/capabilities";
import type { MediaAnalysisDocument } from "@/server/analysis/schema";

export type AnalyzeMediaInput = {
  assetId: string;
  projectId: string;
  storageKey: string;
  kind: string;
  mimeType: string;
  filename: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  checksum: string | null;
  previewStorageKey: string | null;
  requestedCapabilities: AnalysisCapabilityValue[];
};

export type AnalysisProvenance = {
  providerKey: string;
  modelId: string | null;
  modelVersion: string | null;
};

export type MediaAnalysisResult = {
  analysis: MediaAnalysisDocument;
  provenance: AnalysisProvenance;
};

export interface MediaAnalyzerPort {
  analyze(input: AnalyzeMediaInput): Promise<MediaAnalysisResult>;
}
