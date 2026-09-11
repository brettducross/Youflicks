import { describe, expect, it } from "vitest";
import {
  MemoryS3ObjectStore,
  S3CompatibleStorageAdapter,
} from "@/server/adapters/storage/s3";
import {
  disposableRoundtripKey,
  resolveStorageRoundtripConfig,
  runStorageRoundtrip,
  STORAGE_ROUNDTRIP_FAIL_CLOSED,
  STORAGE_ROUNDTRIP_R2_ENDPOINT_REQUIRED,
} from "@/server/adapters/storage/roundtrip";

describe("resolveStorageRoundtripConfig", () => {
  it("fails closed without r2|s3 credentials and does not invent a client config", () => {
    expect(resolveStorageRoundtripConfig({})).toEqual({
      ok: false,
      reason: STORAGE_ROUNDTRIP_FAIL_CLOSED,
    });
    expect(resolveStorageRoundtripConfig({ STORAGE_DRIVER: "local" })).toEqual({
      ok: false,
      reason: STORAGE_ROUNDTRIP_FAIL_CLOSED,
    });
    expect(
      resolveStorageRoundtripConfig({
        STORAGE_DRIVER: "r2",
        STORAGE_S3_BUCKET: "beta-media",
      }),
    ).toEqual({ ok: false, reason: STORAGE_ROUNDTRIP_FAIL_CLOSED });
  });

  it("fails closed when r2 is missing an endpoint", () => {
    expect(
      resolveStorageRoundtripConfig({
        STORAGE_DRIVER: "r2",
        STORAGE_S3_BUCKET: "beta-media",
        STORAGE_S3_ACCESS_KEY_ID: "id",
        STORAGE_S3_SECRET_ACCESS_KEY: "secret",
      }),
    ).toEqual({ ok: false, reason: STORAGE_ROUNDTRIP_R2_ENDPOINT_REQUIRED });
  });

  it("resolves r2 and s3 when required keys are present", () => {
    const r2 = resolveStorageRoundtripConfig({
      STORAGE_DRIVER: "r2",
      STORAGE_S3_BUCKET: "beta-media",
      STORAGE_S3_REGION: "auto",
      STORAGE_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      STORAGE_S3_ACCESS_KEY_ID: "id",
      STORAGE_S3_SECRET_ACCESS_KEY: "secret",
      STORAGE_S3_FORCE_PATH_STYLE: "true",
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.config.driver).toBe("r2");
      expect(r2.config.endpoint).toContain("r2.cloudflarestorage.com");
      expect(r2.config.forcePathStyle).toBe(true);
    }

    const s3 = resolveStorageRoundtripConfig({
      STORAGE_DRIVER: "s3",
      STORAGE_S3_BUCKET: "beta-media",
      STORAGE_S3_REGION: "us-east-1",
      STORAGE_S3_ACCESS_KEY_ID: "id",
      STORAGE_S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(s3.ok).toBe(true);
    if (s3.ok) {
      expect(s3.config.driver).toBe("s3");
      expect(s3.config.endpoint).toBeUndefined();
    }
  });
});

describe("runStorageRoundtrip", () => {
  it("puts, gets, and deletes a disposable opaque key", async () => {
    const storage = new S3CompatibleStorageAdapter(new MemoryS3ObjectStore(), "r2");
    const key = disposableRoundtripKey(1_700_000_000_000, "test-id");
    expect(key).toBe("ops/verify-roundtrip/1700000000000-test-id.txt");
    expect(key).not.toMatch(/^https?:\/\//);

    const result = await runStorageRoundtrip(storage, { key });
    expect(result).toEqual({
      driver: "r2",
      key,
      byteSize: expect.any(Number),
      deleted: true,
    });
    expect(result.byteSize).toBeGreaterThan(0);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });
});
