import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assertPlaybackOpenInputPrivacy, assertPlaybackSessionPrivacy } from "@/server/playback/privacy";
import type { PlaybackOpenInput, PlaybackSession } from "@/server/playback/schema";

function baseInput(): PlaybackOpenInput {
  return {
    projectId: "p1",
    renderJobId: "rj_1",
    startMs: 0,
  };
}

function baseSession(): PlaybackSession {
  return {
    sessionId: "token.sig",
    renderJobId: "rj_1",
    durationMs: 3000,
    mimeType: "video/mp4",
    transport: "APP_STREAM",
    streamPath: "/api/projects/p1/playback/sessions/token.sig/stream",
  };
}

describe("Playback privacy", () => {
  it("accepts a minimized watch request", () => {
    expect(() => assertPlaybackOpenInputPrivacy(baseInput())).not.toThrow();
    const serialized = JSON.stringify(baseInput());
    expect(serialized).not.toMatch(/apiKey|authorization|sponsor|email|ffmpeg|vlc|cdn/i);
  });

  it("rejects sponsor, identity, and vendor URL smuggling on open", () => {
    const dirty = {
      ...baseInput(),
      email: "owner@example.com",
      sponsor: { name: "Harbor Coffee" },
    } as PlaybackOpenInput & Record<string, unknown>;
    expect(() => assertPlaybackOpenInputPrivacy(dirty)).toThrow(AppError);
    expect(() =>
      assertPlaybackOpenInputPrivacy({
        ...baseInput(),
        renderJobId: "https://cdn.vendor.example/out.mp4",
      }),
    ).toThrow(AppError);
  });

  it("rejects storage keys and vendor URLs on public sessions", () => {
    expect(() => assertPlaybackSessionPrivacy(baseSession())).not.toThrow();
    expect(() =>
      assertPlaybackSessionPrivacy({
        ...baseSession(),
        outputKey: "projects/p1/renders/rj_1/output.mp4",
      } as PlaybackSession & { outputKey: string }),
    ).toThrow(AppError);
    expect(() =>
      assertPlaybackSessionPrivacy({
        ...baseSession(),
        streamPath: "https://cdn.vendor.example/out.mp4",
      }),
    ).toThrow(AppError);
  });
});
