import { describe, expect, it } from "vitest";
import { libraryStorageKey } from "@/server/movie/schema";

describe("libraryStorageKey", () => {
  it("uses the locked library path, not a render pointer", () => {
    expect(libraryStorageKey("proj_1", "movie_1")).toBe("projects/proj_1/movies/movie_1/output.mp4");
    expect(libraryStorageKey("proj_1", "movie_1")).not.toMatch(/renders/);
  });
});
