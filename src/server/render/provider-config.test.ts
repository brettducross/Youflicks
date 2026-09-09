import { describe, expect, it } from "vitest";
import { isLocalRendererAllowed } from "@/server/render/provider-config";

describe("isLocalRendererAllowed", () => {
  it("allows explicit local rendering outside production", () => {
    expect(isLocalRendererAllowed("development", true)).toBe(true);
    expect(isLocalRendererAllowed("test", true)).toBe(true);
  });

  it("never enables local rendering in production", () => {
    expect(isLocalRendererAllowed("production", true)).toBe(false);
    expect(isLocalRendererAllowed("production", false)).toBe(false);
  });

  it("requires explicit opt-in even in development", () => {
    expect(isLocalRendererAllowed("development", false)).toBe(false);
  });
});
