export {
  ACCEPT_ATTRIBUTE,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_VIDEO_BYTES,
} from "@/server/media/constants";

export type MediaAnalysisView = {
  id: string;
  assetId: string;
  status: string;
  schemaVersion: string;
  providerKey: string;
  modelId: string | null;
  modelVersion: string | null;
  analyzedAt: string | null;
  createdAt: string;
  error: string | null;
  analysis: Record<string, unknown> | null;
};

export type MediaAssetView = {
  id: string;
  filename: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  status: string;
  analysisStatus: string;
  latestAnalysisId: string | null;
  createdAt: string;
  previewUrl: string | null;
  originalUrl: string;
};
