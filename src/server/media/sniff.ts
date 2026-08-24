import { fileTypeFromBuffer } from "file-type";
import { AppError } from "@/lib/errors";
import {
  ALLOWED_MEDIA_TYPES,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_VIDEO_BYTES,
  MediaKind,
  type AllowedMimeType,
} from "@/server/media/constants";

export type SniffedMedia = {
  mimeType: AllowedMimeType;
  kind: (typeof MediaKind)[keyof typeof MediaKind];
  extension: string;
};

export type MediaLimitConfig = {
  maxImageBytes: number;
  maxVideoBytes: number;
};

export const defaultMediaLimits: MediaLimitConfig = {
  maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
  maxVideoBytes: DEFAULT_MAX_VIDEO_BYTES,
};

export function maxBytesForKind(
  kind: SniffedMedia["kind"],
  limits: MediaLimitConfig = defaultMediaLimits,
) {
  return kind === MediaKind.VIDEO ? limits.maxVideoBytes : limits.maxImageBytes;
}

export function validateByteSize(
  byteSize: number,
  kind: SniffedMedia["kind"],
  limits: MediaLimitConfig = defaultMediaLimits,
) {
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    throw AppError.validation("That file is empty.");
  }
  const max = maxBytesForKind(kind, limits);
  if (byteSize > max) {
    const mb = Math.round(max / (1024 * 1024));
    throw AppError.validation(
      kind === MediaKind.VIDEO
        ? `Videos must be ${mb} MB or smaller.`
        : `Photos must be ${mb} MB or smaller.`,
    );
  }
}

export function sanitizeFilename(filename: string) {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? "untitled";
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, "_").trim() || "untitled";
  return cleaned.slice(0, 180);
}

export async function sniffMedia(bytes: Uint8Array): Promise<SniffedMedia> {
  let detected: { mime: string } | undefined;
  try {
    detected = await fileTypeFromBuffer(bytes);
  } catch {
    throw AppError.validation("That file type is not a photo or video we can ingest.");
  }
  if (!detected) {
    throw AppError.validation("That file type is not a photo or video we can ingest.");
  }

  const mimeType = detected.mime as AllowedMimeType;
  const allowed = ALLOWED_MEDIA_TYPES[mimeType];
  if (!allowed) {
    throw AppError.validation(
      `YouFlicks cannot ingest ${detected.mime} files. Use JPEG, PNG, WEBP, HEIC, MP4, MOV, or WEBM.`,
    );
  }

  return {
    mimeType,
    kind: allowed.kind,
    extension: allowed.extension,
  };
}
