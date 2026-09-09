import { execFileSync } from "node:child_process";
import { AppError } from "@/lib/errors";
import type { PlaybackPort } from "@/server/ports/playback";
import type {
  PlaybackOpenInput,
  PlaybackResolvedSource,
  PlaybackSession,
  PlaybackStatus,
} from "@/server/playback/schema";
import { PlaybackSessionStore } from "@/server/playback/sessions";

/**
 * VLC / libVLC adapter. Preferred on desktop/native surfaces only.
 *
 * Adapter-only: no VLC types, columns, or vendor enums enter Prisma or domain
 * documents. This process does not spawn a VLC window — a native host uses the
 * NATIVE_HANDLE session. Web continues through WebMediaPlaybackAdapter.
 */
export class VlcPlaybackAdapter implements PlaybackPort {
  readonly adapterKey = "youflicks.vlc";

  constructor(
    private readonly sessions: PlaybackSessionStore,
    private readonly lookup: () => boolean = detectVlcRuntime,
  ) {}

  available() {
    return this.lookup();
  }

  async open(input: PlaybackOpenInput, source: PlaybackResolvedSource): Promise<PlaybackSession> {
    if (!this.available()) {
      throw AppError.playbackAdapterUnavailable(
        "Native watch is not available on this surface. Watch in the browser instead.",
      );
    }
    const record = this.sessions.issue({
      viewerId: source.viewerId,
      projectId: input.projectId,
      renderJobId: input.renderJobId,
      outputKey: source.outputKey,
      mimeType: source.mimeType,
      durationMs: source.durationMs,
      startMs: input.startMs,
      transport: "NATIVE_HANDLE",
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

/** Adapter-local probe. Never persisted. Override in tests. */
export function detectVlcRuntime(): boolean {
  const configured = process.env.VLC_BIN?.trim();
  const candidates = configured ? [configured] : ["vlc", "cvlc", "libvlc"];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 1500 });
      return true;
    } catch {
      // Try the next candidate.
    }
  }
  return false;
}
