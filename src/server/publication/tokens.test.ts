import { describe, expect, it } from "vitest";
import {
  isShareTokenSecretConfigured,
  resolveShareSigningSecret,
  ShareTokenStore,
} from "@/server/publication/tokens";

describe("resolveShareSigningSecret", () => {
  it("treats empty or unset SHARE_TOKEN_SECRET as share-disabled", () => {
    expect(resolveShareSigningSecret(undefined)).toBe("");
    expect(resolveShareSigningSecret("")).toBe("");
    expect(resolveShareSigningSecret("   ")).toBe("");
    expect(isShareTokenSecretConfigured(undefined)).toBe(false);
    expect(isShareTokenSecretConfigured("")).toBe(false);
    expect(isShareTokenSecretConfigured("   ")).toBe(false);
    const authSecret = "better-auth-secret-value";
    expect(resolveShareSigningSecret(undefined)).not.toBe(authSecret);
    const store = new ShareTokenStore(resolveShareSigningSecret(undefined));
    expect(store.configured).toBe(false);
    expect(() => store.issue({ publicationId: "pub_1", movieId: "m1" })).toThrow(/not configured/i);
  });

  it("enables share when SHARE_TOKEN_SECRET is set", () => {
    const secret = "share-token-explicit-secret";
    expect(resolveShareSigningSecret(secret)).toBe(secret);
    expect(isShareTokenSecretConfigured(secret)).toBe(true);
    const store = new ShareTokenStore(resolveShareSigningSecret(secret));
    expect(store.configured).toBe(true);
    const issued = store.issue({ publicationId: "pub_1", movieId: "m1" });
    expect(store.verify(issued.token).publicationId).toBe("pub_1");
  });
});

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
