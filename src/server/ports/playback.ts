import type {
  PlaybackOpenInput,
  PlaybackResolvedSource,
  PlaybackSession,
  PlaybackStatus,
} from "@/server/playback/schema";

/**
 * Provider-neutral playback port.
 *
 * Adapters open an ephemeral viewing session against a SUCCEEDED RenderJob
 * or a READY FinishedMovie (M6 finishedMovieId). VLC / libVLC and HTML5 media
 * are adapters only — never Prisma or domain schema.
 * This port does not create FinishedMovie, Publication, or mutate render bytes.
 */
export interface PlaybackPort {
  open(input: PlaybackOpenInput, source: PlaybackResolvedSource): Promise<PlaybackSession>;
  getStatus(sessionId: string): Promise<PlaybackStatus>;
  close(sessionId: string): Promise<void>;
}
