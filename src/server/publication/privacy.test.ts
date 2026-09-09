import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  assertPublicationInputPrivacy,
  assertPublicationViewPrivacy,
  sanitizePublicationPayload,
} from "@/server/publication/privacy";
import type { PublicationView } from "@/server/publication/schema";

function baseView(): PublicationView {
  return {
    id: "pub_1",
    movieId: "m1",
    destinationKey: "SHARE_LINK",
    status: "PUBLISHED",
    externalId: null,
    payload: {
      expiresAt: "2026-09-16T00:00:00.000Z",
      tokenFingerprint: "abc",
    },
    publishedAt: "2026-09-09T00:00:00.000Z",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
}

describe("Publication privacy", () => {
  it("accepts a minimized share request", () => {
    expect(() => assertPublicationInputPrivacy({ expiresAt: "2026-09-16T00:00:00.000Z" })).not.toThrow();
  });

  it("rejects secrets, sponsor fields, and vendor URLs", () => {
    expect(() =>
      assertPublicationInputPrivacy({ token: "secret" } as { token: string }),
    ).toThrow(AppError);
    expect(() =>
      assertPublicationInputPrivacy({ sponsor: "Harbor" } as { sponsor: string }),
    ).toThrow(AppError);
    expect(() =>
      assertPublicationInputPrivacy({ expiresAt: "https://cdn.vendor.example/out.mp4" }),
    ).toThrow(AppError);
  });

  it("rejects raw tokens and storage keys on public views", () => {
    expect(() => assertPublicationViewPrivacy(baseView())).not.toThrow();
    expect(() =>
      assertPublicationViewPrivacy({
        ...baseView(),
        token: "raw-token",
      } as PublicationView & { token: string }),
    ).toThrow(AppError);
  });

  it("keeps only YouFlicks-owned payload fields", () => {
    const clean = sanitizePublicationPayload({
      expiresAt: "2026-09-16T00:00:00.000Z",
      token: "raw-secret",
      email: "owner@example.com",
      tokenFingerprint: "deadbeef",
    });
    expect(clean?.expiresAt).toBe("2026-09-16T00:00:00.000Z");
    expect(clean?.tokenFingerprint).toBe("deadbeef");
    expect(clean).not.toHaveProperty("token");
    expect(clean).not.toHaveProperty("email");
  });
});
