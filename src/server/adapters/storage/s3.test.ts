import { describe, expect, it } from "vitest";
import {
  assertOpaqueStorageKey,
  MemoryS3ObjectStore,
  S3CompatibleStorageAdapter,
} from "@/server/adapters/storage/s3";

describe("S3CompatibleStorageAdapter W1.4", () => {
  it("round-trips opaque keys without leaking a vendor URL", async () => {
    const storage = new S3CompatibleStorageAdapter(new MemoryS3ObjectStore(), "r2");
    const key = "projects/p1/assets/a1/original.png";
    const body = new Uint8Array([1, 2, 3, 4]);
    const stored = await storage.put({ key, body, contentType: "image/png" });
    expect(stored.key).toBe(key);
    expect(stored.key).not.toMatch(/^https?:\/\//);
    expect(storage.driver).toBe("r2");

    expect(await storage.exists(key)).toBe(true);
    const got = await storage.get(key);
    expect(got?.body).toEqual(body);
    expect(got?.contentType).toBe("image/png");

    const ranged = await storage.getStream(key, { start: 1, end: 2 });
    expect(ranged?.contentLength).toBe(2);
    expect(ranged?.range).toEqual({ start: 1, end: 2 });

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.get(key)).toBeNull();
  });

  it("rejects vendor URLs and path escape as storage keys", () => {
    expect(() => assertOpaqueStorageKey("https://cdn.vendor.test/clip.mp4")).toThrow(
      /Invalid storage key/,
    );
    expect(() => assertOpaqueStorageKey("../etc/passwd")).toThrow(/Invalid storage key/);
  });
});
