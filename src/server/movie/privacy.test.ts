import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assertFinishedMovieViewPrivacy, assertMovieKeepInputPrivacy } from "@/server/movie/privacy";
import type { FinishedMovieView } from "@/server/movie/schema";

function baseView(): FinishedMovieView {
  return {
    id: "m1",
    projectId: "p1",
    renderJobId: "rj_1",
    title: "Kept film",
    status: "READY",
    durationMs: 3000,
    mimeType: "video/mp4",
    byteSize: 32,
    checksum: "abc",
    keptAt: "2026-09-09T00:00:00.000Z",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
}

describe("Movie privacy", () => {
  it("accepts a minimized keep request", () => {
    expect(() => assertMovieKeepInputPrivacy({ renderJobId: "rj_1", title: "Family film" })).not.toThrow();
  });

  it("rejects sponsor fields and vendor URLs on keep input", () => {
    expect(() =>
      assertMovieKeepInputPrivacy({
        renderJobId: "rj_1",
        sponsor: "Harbor Coffee",
      } as { renderJobId: string; sponsor: string }),
    ).toThrow(AppError);
    expect(() =>
      assertMovieKeepInputPrivacy({
        renderJobId: "https://cdn.vendor.example/out.mp4",
      }),
    ).toThrow(AppError);
  });

  it("rejects storage keys on public library views", () => {
    expect(() => assertFinishedMovieViewPrivacy(baseView())).not.toThrow();
    expect(() =>
      assertFinishedMovieViewPrivacy({
        ...baseView(),
        storageKey: "projects/p1/movies/m1/output.mp4",
      } as FinishedMovieView & { storageKey: string }),
    ).toThrow(AppError);
  });
});
