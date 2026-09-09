export const PUBLICATION_PAYLOAD_SCHEMA_VERSION = "1.0";

/** YouFlicks destination keys. Open strings — never Prisma vendor enums. */
export const PublicationDestination = {
  DOWNLOAD: "DOWNLOAD",
  SHARE_LINK: "SHARE_LINK",
} as const;

export type PublicationDestinationValue =
  (typeof PublicationDestination)[keyof typeof PublicationDestination];

export const SHARE_LINK_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SHARE_LINK_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type PublicationPayload = {
  schemaVersion?: typeof PUBLICATION_PAYLOAD_SCHEMA_VERSION;
  expiresAt?: string;
  revokedAt?: string;
  tokenFingerprint?: string;
  adapterMeta?: Record<string, unknown>;
};

export type PublicationView = {
  id: string;
  movieId: string;
  destinationKey: string;
  status: string;
  externalId: string | null;
  payload: PublicationPayload | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicationAvailability = {
  canExport: boolean;
  canShareLink: boolean;
  storageReadable: boolean;
  shareTokenConfigured: boolean;
  movieReady: boolean;
};

export type PublicationExportInput = {
  /** When true, enqueue PUBLISH and return 202. Local DOWNLOAD stays sync by default. */
  async?: boolean;
};

export type PublicationShareLinkInput = {
  expiresAt?: string;
  /** When true, enqueue PUBLISH and return 202. SHARE_LINK stays sync by default. */
  async?: boolean;
};

export type PublicationAccepted = {
  jobId: string;
  status: "ACCEPTED";
};

export type ShareLinkCreated = {
  publication: PublicationView;
  shareUrl: string;
  token: string;
};

export type PublicationJobStatusView = {
  jobId: string;
  publicationId: string | null;
  destinationKey: string | null;
  status: string;
  error: string | null;
  shareUrl: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ShareWatchGrant = {
  publicationId: string;
  movieId: string;
  projectId: string;
  renderJobId: string;
  storageKey: string;
  mimeType: string;
  durationMs: number;
  byteSize?: number;
  title: string;
  expiresAt: string;
};

export type PublicationShareAccess = {
  verifyShareToken(token: string): Promise<ShareWatchGrant>;
  assertShareWatchable(publicationId: string): Promise<ShareWatchGrant>;
};

export function isPublicationAccepted(
  value: PublicationView | ShareLinkCreated | PublicationAccepted,
): value is PublicationAccepted {
  return "jobId" in value && value.status === "ACCEPTED";
}

export function attachmentFilename(title: string, ext = "mp4") {
  const base =
    title
      .replace(/[^\w\s.-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "film";
  return `${base}.${ext}`;
}

export function shareWatchPath(token: string) {
  return `/watch/${encodeURIComponent(token)}`;
}
