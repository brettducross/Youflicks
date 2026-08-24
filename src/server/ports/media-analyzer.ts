/**
 * Media analysis port.
 *
 * Phase 1 ships the interface only. A later adapter will inspect
 * photos/video without the rest of the app knowing which vendor ran.
 */
export type AnalyzeMediaInput = {
  assetId: string;
  storageKey: string;
  kind: string;
  mimeType: string;
};

export type MediaAnalysisDraft = {
  providerKey: string;
  payload: unknown;
};

export interface MediaAnalyzerPort {
  readonly providerKey: string;
  analyze(input: AnalyzeMediaInput): Promise<MediaAnalysisDraft>;
}
