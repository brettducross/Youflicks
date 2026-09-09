import { describe, expect, it } from "vitest";
import { PlaybackSessionStore } from "@/server/playback/sessions";

describe("PlaybackSessionStore", () => {
  it("issues, reads, and expires short-lived sessions", () => {
    let now = 1_000_000;
    const store = new PlaybackSessionStore("session-test-secret", () => now, 1_000);
    const record = store.issue({
      viewerId: "user_1",
      projectId: "p1",
      renderJobId: "rj_1",
      outputKey: "projects/p1/renders/rj_1/output.mp4",
      mimeType: "video/mp4",
      durationMs: 2500,
      transport: "APP_STREAM",
    });
    expect(store.read(record.sessionId).outputKey).toBe("projects/p1/renders/rj_1/output.mp4");
    expect(store.toPublic(record)).not.toHaveProperty("outputKey");
    now += 2_000;
    expect(() => store.read(record.sessionId)).toThrow(/expired/i);
    expect(store.status(record.sessionId).state).toBe("EXPIRED");
  });

  it("rejects vendor URL keys", () => {
    const store = new PlaybackSessionStore("session-test-secret");
    expect(() =>
      store.issue({
        viewerId: "user_1",
        projectId: "p1",
        renderJobId: "rj_1",
        outputKey: "https://cdn.vendor.example/out.mp4",
        mimeType: "video/mp4",
        durationMs: 1000,
        transport: "APP_STREAM",
      }),
    ).toThrow(/opaque/i);
  });
});
