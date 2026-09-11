import { describe, expect, it } from "vitest";
import { inviteOnlyEnabled, isHttpVisionConfigured, resolveInviteOnly } from "@/server/beta/flags";

describe("Wave 1 flags", () => {
  it("fails closed to invite-only in production when the flag is unset", () => {
    expect(resolveInviteOnly("production", undefined)).toBe(true);
    expect(resolveInviteOnly("production", false)).toBe(false);
    expect(resolveInviteOnly("test", undefined)).toBe(false);
    expect(resolveInviteOnly("development", true)).toBe(true);
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
