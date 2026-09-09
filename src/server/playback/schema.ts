export const PLAYBACK_TRANSPORTS = ["APP_STREAM", "NATIVE_HANDLE"] as const;

export type PlaybackTransport = (typeof PLAYBACK_TRANSPORTS)[number];

export const PLAYBACK_SURFACES = ["web", "native"] as const;

export type PlaybackSurface = (typeof PLAYBACK_SURFACES)[number];

export const PLAYBACK_STATUS_STATES = ["OPEN", "CLOSED", "EXPIRED"] as const;

export type PlaybackStatusState = (typeof PLAYBACK_STATUS_STATES)[number];

/** Soft-locked public open input. Engineer-gate TypeScript shape. */
export type PlaybackOpenInput = {
  projectId: string;
  renderJobId: string;
  startMs?: number;
};

/**
 * Service-resolved source after ownership + SUCCEEDED RenderJob checks.
 * Adapters receive opaque StoragePort metadata only — never vendor CDN URLs.
 */
export type PlaybackResolvedSource = {
  viewerId: string;
  outputKey: string;
  mimeType: string;
  durationMs: number;
  byteSize?: number;
};

export type PlaybackSession = {
  sessionId: string;
  renderJobId: string;
  durationMs: number;
  mimeType: string;
  transport: PlaybackTransport;
  streamPath?: string;
};

export type PlaybackStatus = {
  sessionId: string;
  renderJobId: string;
  state: PlaybackStatusState;
};

export type PlaybackAvailability = {
  webAvailable: boolean;
  nativeAvailable: boolean;
  canWatch: boolean;
};

export const PLAYBACK_SESSION_TTL_MS = 15 * 60 * 1000;
