import { describe, expect, it } from "vitest";
import { WebMediaPlaybackAdapter } from "@/server/adapters/playback/web-media";
import { PlaybackSessionStore } from "@/server/playback/sessions";

describe("WebMediaPlaybackAdapter", () => {
  it("opens an APP_STREAM session with an app-relative path", async () => {
    const sessions = new PlaybackSessionStore("playback-web-test-secret");
    const adapter = new WebMediaPlaybackAdapter(sessions);
    const session = await adapter.open(
      { projectId: "p1", renderJobId: "rj_1", startMs: 250 },
      {
        viewerId: "user_1",
        outputKey: "projects/p1/renders/rj_1/output.mp4",
        mimeType: "video/mp4",
        durationMs: 4000,
      },
    );
    expect(session.transport).toBe("APP_STREAM");
    expect(session.streamPath).toMatch(
      /^\/api\/projects\/p1\/playback\/sessions\/.+\/stream$/,
    );
    expect(session.streamPath).not.toMatch(/^https?:\/\//);
    expect(session).not.toHaveProperty("outputKey");
    expect(session).not.toHaveProperty("vlc");
    const status = await adapter.getStatus(session.sessionId);
    expect(status.state).toBe("OPEN");
    await adapter.close(session.sessionId);
    expect((await adapter.getStatus(session.sessionId)).state).toBe("CLOSED");
  });
});
