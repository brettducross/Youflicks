import type { PlaybackPort } from "@/server/ports/playback";
import type {
  PlaybackOpenInput,
  PlaybackResolvedSource,
  PlaybackSession,
  PlaybackStatus,
} from "@/server/playback/schema";
import { PlaybackSessionStore } from "@/server/playback/sessions";

/**
 * HTML5 / browser media adapter. Default web surface.
 * Streams through an app-relative owner-auth path — never a vendor CDN URL.
 */
export class WebMediaPlaybackAdapter implements PlaybackPort {
  readonly adapterKey = "youflicks.web.media";

  constructor(private readonly sessions: PlaybackSessionStore) {}

  async open(input: PlaybackOpenInput, source: PlaybackResolvedSource): Promise<PlaybackSession> {
    const record = this.sessions.issue({
      viewerId: source.viewerId,
      projectId: input.projectId,
      renderJobId: input.renderJobId ?? "",
      finishedMovieId: input.finishedMovieId,
      outputKey: source.outputKey,
      mimeType: source.mimeType,
      durationMs: source.durationMs,
      startMs: input.startMs,
      transport: "APP_STREAM",
    });
    return this.sessions.toPublic(record);
  }

  async getStatus(sessionId: string): Promise<PlaybackStatus> {
    return this.sessions.status(sessionId);
  }

  async close(sessionId: string): Promise<void> {
    this.sessions.close(sessionId);
  }
}
