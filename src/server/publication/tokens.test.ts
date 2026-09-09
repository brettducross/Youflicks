import { describe, expect, it } from "vitest";
import { ShareTokenStore } from "@/server/publication/tokens";

describe("ShareTokenStore", () => {
  it("issues, verifies, and expires time-limited tokens", () => {
    let now = 1_000_000;
    const store = new ShareTokenStore("share-token-test-secret", () => now, 1_000);
    const issued = store.issue({ publicationId: "pub_1", movieId: "m1" });
    expect(issued.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(store.verify(issued.token).publicationId).toBe("pub_1");
    now += 2_000;
    expect(() => store.verify(issued.token)).toThrow(/expired/i);
  });

  it("rejects tampered tokens and past expiry", () => {
    const store = new ShareTokenStore("share-token-test-secret");
    const issued = store.issue({ publicationId: "pub_1", movieId: "m1" });
    expect(() => store.verify(`${issued.token}x`)).toThrow(/not valid/i);
    expect(() => store.issue({ publicationId: "pub_1", movieId: "m1", expiresAt: new Date(0) })).toThrow(
      /future expiry/i,
    );
  });

  it("is unconfigured without a signing secret", () => {
    const store = new ShareTokenStore("short");
    expect(store.configured).toBe(false);
    expect(() => store.issue({ publicationId: "pub_1", movieId: "m1" })).toThrow(/not configured/i);
  });
});
