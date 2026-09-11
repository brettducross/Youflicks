import { randomUUID } from "node:crypto";
import type { StoragePort } from "@/server/ports/storage";
import type { S3CompatibleConfig } from "@/server/adapters/storage/s3";

export const STORAGE_ROUNDTRIP_FAIL_CLOSED =
  "Storage roundtrip refused: STORAGE_DRIVER must be r2 or s3 with STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, and STORAGE_S3_SECRET_ACCESS_KEY. Local disk and missing credentials fail closed. No live request was made.";

export const STORAGE_ROUNDTRIP_R2_ENDPOINT_REQUIRED =
  "Storage roundtrip refused: STORAGE_DRIVER=r2 requires STORAGE_S3_ENDPOINT (Cloudflare R2 account URL). No live request was made.";

const DISPOSABLE_PREFIX = "ops/verify-roundtrip";

export type StorageRoundtripEnv = {
  STORAGE_DRIVER?: string;
  STORAGE_S3_BUCKET?: string;
  STORAGE_S3_REGION?: string;
  STORAGE_S3_ENDPOINT?: string;
  STORAGE_S3_ACCESS_KEY_ID?: string;
  STORAGE_S3_SECRET_ACCESS_KEY?: string;
  STORAGE_S3_FORCE_PATH_STYLE?: string;
  [key: string]: string | undefined;
};

export type StorageRoundtripResolved =
  | { ok: true; config: S3CompatibleConfig }
  | { ok: false; reason: string };

export type StorageRoundtripResult = {
  driver: string;
  key: string;
  byteSize: number;
  deleted: boolean;
};

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseForcePathStyle(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

/**
 * Fail-closed resolver for the ops storage roundtrip helper.
 * Does not read secrets from disk, does not print credentials, and does not
 * construct an S3 client until the caller has a successful result.
 */
export function resolveStorageRoundtripConfig(
  env: StorageRoundtripEnv,
): StorageRoundtripResolved {
  const driver = emptyToUndefined(env.STORAGE_DRIVER);
  if (driver !== "r2" && driver !== "s3") {
    return { ok: false, reason: STORAGE_ROUNDTRIP_FAIL_CLOSED };
  }
  const bucket = emptyToUndefined(env.STORAGE_S3_BUCKET);
  const accessKeyId = emptyToUndefined(env.STORAGE_S3_ACCESS_KEY_ID);
  const secretAccessKey = emptyToUndefined(env.STORAGE_S3_SECRET_ACCESS_KEY);
  if (!bucket || !accessKeyId || !secretAccessKey) {
    return { ok: false, reason: STORAGE_ROUNDTRIP_FAIL_CLOSED };
  }
  const endpoint = emptyToUndefined(env.STORAGE_S3_ENDPOINT);
  if (driver === "r2" && !endpoint) {
    return { ok: false, reason: STORAGE_ROUNDTRIP_R2_ENDPOINT_REQUIRED };
  }
  return {
    ok: true,
    config: {
      driver,
      bucket,
      region: emptyToUndefined(env.STORAGE_S3_REGION) ?? "auto",
      endpoint,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: parseForcePathStyle(env.STORAGE_S3_FORCE_PATH_STYLE),
    },
  };
}

export function disposableRoundtripKey(now = Date.now(), id: string = randomUUID()): string {
  return `${DISPOSABLE_PREFIX}/${now}-${id}.txt`;
}

/**
 * put → get → delete a disposable opaque key. Always attempts delete after put.
 * Callers must pass a StoragePort; this helper never logs credentials.
 */
export async function runStorageRoundtrip(
  storage: StoragePort,
  input: { key?: string; body?: Uint8Array } = {},
): Promise<StorageRoundtripResult> {
  const key = input.key ?? disposableRoundtripKey();
  const body = input.body ?? new TextEncoder().encode(`youflicks-storage-roundtrip ${key}\n`);
  let putCompleted = false;
  try {
    const stored = await storage.put({
      key,
      body,
      contentType: "text/plain; charset=utf-8",
    });
    putCompleted = true;
    if (stored.key !== key || stored.key.includes("://")) {
      throw new Error("Storage roundtrip failed: put did not return the opaque key.");
    }
    const got = await storage.get(key);
    if (!got) {
      throw new Error("Storage roundtrip failed: get after put returned null.");
    }
    if (got.key !== key || got.key.includes("://")) {
      throw new Error("Storage roundtrip failed: get leaked a non-opaque key.");
    }
    if (got.body.byteLength !== body.byteLength) {
      throw new Error("Storage roundtrip failed: get byte length did not match put.");
    }
    for (let i = 0; i < body.byteLength; i += 1) {
      if (got.body[i] !== body[i]) {
        throw new Error("Storage roundtrip failed: get bytes did not match put.");
      }
    }
    await storage.delete(key);
    const afterDelete = await storage.get(key);
    if (afterDelete) {
      throw new Error("Storage roundtrip failed: get after delete still returned an object.");
    }
    return {
      driver: storage.driver,
      key,
      byteSize: body.byteLength,
      deleted: true,
    };
  } catch (error) {
    if (putCompleted) {
      try {
        await storage.delete(key);
      } catch {
        // Best-effort cleanup; original error is more useful.
      }
    }
    throw error;
  }
}
