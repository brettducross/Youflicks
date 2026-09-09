import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { VlcPlaybackAdapter } from "@/server/adapters/playback/vlc";
import { PlaybackSessionStore } from "@/server/playback/sessions";

describe("VlcPlaybackAdapter", () => {
  it("is adapter-only and returns NATIVE_HANDLE when the runtime is present", async () => {
    const sessions = new PlaybackSessionStore("playback-vlc-test-secret");
    const adapter = new VlcPlaybackAdapter(sessions, () => true);
    const session = await adapter.open(
      { projectId: "p1", renderJobId: "rj_1" },
      {
        viewerId: "user_1",
        outputKey: "projects/p1/renders/rj_1/output.mp4",
        mimeType: "video/mp4",
        durationMs: 4000,
      },
    );
    expect(session.transport).toBe("NATIVE_HANDLE");
    expect(session.streamPath).toBeUndefined();
    expect(JSON.stringify(session)).not.toMatch(/libvlc|cdn\.|https?:\/\//i);
    expect(adapter.adapterKey).toBe("youflicks.vlc");
  });

  it("fails honestly when VLC/libVLC is not available", async () => {
    const sessions = new PlaybackSessionStore("playback-vlc-test-secret");
    const adapter = new VlcPlaybackAdapter(sessions, () => false);
    await expect(
      adapter.open(
        { projectId: "p1", renderJobId: "rj_1" },
        {
          viewerId: "user_1",
          outputKey: "projects/p1/renders/rj_1/output.mp4",
          mimeType: "video/mp4",
          durationMs: 4000,
        },
      ),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "PLAYBACK_ADAPTER_UNAVAILABLE",
    });
    expect(() => {
      throw AppError.playbackAdapterUnavailable();
    }).toThrow(AppError);
  });
});
