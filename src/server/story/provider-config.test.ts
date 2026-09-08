import { describe, expect, it } from "vitest";
import { isLocalStoryComposerAllowed } from "@/server/story/provider-config";

describe("isLocalStoryComposerAllowed", () => {
  it("allows explicit local story composition outside production", () => {
    expect(isLocalStoryComposerAllowed("development", true)).toBe(true);
    expect(isLocalStoryComposerAllowed("test", true)).toBe(true);
  });

  it("never enables local story composition in production", () => {
    expect(isLocalStoryComposerAllowed("production", true)).toBe(false);
    expect(isLocalStoryComposerAllowed("production", false)).toBe(false);
  });

  it("requires explicit opt-in even in development", () => {
    expect(isLocalStoryComposerAllowed("development", false)).toBe(false);
  });
});
