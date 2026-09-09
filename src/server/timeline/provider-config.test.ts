import { describe, expect, it } from "vitest";
import { isLocalTimelineComposerAllowed } from "@/server/timeline/provider-config";

describe("isLocalTimelineComposerAllowed", () => {
  it("allows explicit local timeline composition outside production", () => {
    expect(isLocalTimelineComposerAllowed("development", true)).toBe(true);
    expect(isLocalTimelineComposerAllowed("test", true)).toBe(true);
  });

  it("never enables local timeline composition in production", () => {
    expect(isLocalTimelineComposerAllowed("production", true)).toBe(false);
    expect(isLocalTimelineComposerAllowed("production", false)).toBe(false);
  });

  it("requires explicit opt-in even in development", () => {
    expect(isLocalTimelineComposerAllowed("development", false)).toBe(false);
  });
});
