export {
  ACCEPT_ATTRIBUTE,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_VIDEO_BYTES,
} from "@/server/media/constants";

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
  createdAt: string;
  previewUrl: string | null;
  originalUrl: string;
};
