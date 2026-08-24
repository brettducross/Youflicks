export const MediaKind = {
  PHOTO: "PHOTO",
  VIDEO: "VIDEO",
  AUDIO: "AUDIO",
  OTHER: "OTHER",
} as const;

export type MediaKindValue = (typeof MediaKind)[keyof typeof MediaKind];

export const MediaStatus = {
  UPLOADING: "UPLOADING",
  READY: "READY",
  FAILED: "FAILED",
  ARCHIVED: "ARCHIVED",
} as const;

export type MediaStatusValue = (typeof MediaStatus)[keyof typeof MediaStatus];

export const DEFAULT_MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const DEFAULT_MAX_VIDEO_BYTES = 512 * 1024 * 1024;

export const ALLOWED_MEDIA_TYPES = {
  "image/jpeg": { kind: MediaKind.PHOTO, extension: ".jpg" },
  "image/png": { kind: MediaKind.PHOTO, extension: ".png" },
  "image/webp": { kind: MediaKind.PHOTO, extension: ".webp" },
  "image/heic": { kind: MediaKind.PHOTO, extension: ".heic" },
  "image/heif": { kind: MediaKind.PHOTO, extension: ".heif" },
  "video/mp4": { kind: MediaKind.VIDEO, extension: ".mp4" },
  "video/quicktime": { kind: MediaKind.VIDEO, extension: ".mov" },
  "video/webm": { kind: MediaKind.VIDEO, extension: ".webm" },
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_MEDIA_TYPES;

export const ACCEPT_ATTRIBUTE = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  ".mp4",
  ".mov",
  ".webm",
].join(",");
