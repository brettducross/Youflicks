import { describe, expect, it } from "vitest";
import { inviteOnlyEnabled, isHttpVisionConfigured } from "@/server/beta/flags";

describe("Wave 1 flags", () => {
  it("fails closed to invite-only in production when the flag is unset", () => {
    expect(inviteOnlyEnabled("production", undefined)).toBe(true);
    expect(inviteOnlyEnabled("production", false)).toBe(false);
    expect(inviteOnlyEnabled("test", undefined)).toBe(false);
    expect(inviteOnlyEnabled("development", true)).toBe(true);
  });

  it("detects HTTP vision only when URL, key, and model are set", () => {
    expect(isHttpVisionConfigured({})).toBe(false);
    expect(
      isHttpVisionConfigured({
        ANALYSIS_HTTP_BASE_URL: "https://vision.example",
        ANALYSIS_HTTP_API_KEY: "k",
        ANALYSIS_HTTP_MODEL: "v1",
      }),
    ).toBe(true);
  });
});
