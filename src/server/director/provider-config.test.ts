import { describe, expect, it } from "vitest";
import { isLocalDirectorAllowed } from "@/server/director/provider-config";

describe("isLocalDirectorAllowed", () => {
  it("allows explicit local Director outside production", () => {
    expect(isLocalDirectorAllowed("development", true)).toBe(true);
    expect(isLocalDirectorAllowed("test", true)).toBe(true);
  });

  it("never enables local Director in production", () => {
    expect(isLocalDirectorAllowed("production", true)).toBe(false);
    expect(isLocalDirectorAllowed("production", false)).toBe(false);
  });

  it("requires explicit opt-in even in development", () => {
    expect(isLocalDirectorAllowed("development", false)).toBe(false);
  });
});
