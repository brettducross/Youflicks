/**
 * Ops helper: fail-closed StoragePort put/get/delete against R2 or S3.
 *
 * Usage (no secrets in git):
 *   npx tsx scripts/verify-storage-roundtrip.ts
 *   npm run ops:verify-storage
 *
 * Requires STORAGE_DRIVER=r2|s3 plus STORAGE_S3_BUCKET / ACCESS_KEY_ID /
 * SECRET_ACCESS_KEY (and STORAGE_S3_ENDPOINT for R2). Missing credentials
 * exit 1 without making a network call.
 *
 * This script does not mint invites, open registration, or print secrets.
 */
import { config as loadEnv } from "dotenv";
import {
  createAwsS3Store,
  S3CompatibleStorageAdapter,
} from "@/server/adapters/storage/s3";
import {
  resolveStorageRoundtripConfig,
  runStorageRoundtrip,
} from "@/server/adapters/storage/roundtrip";

loadEnv();

async function main() {
  const resolved = resolveStorageRoundtripConfig(process.env);
  if (!resolved.ok) {
    console.error(resolved.reason);
    process.exit(1);
  }

  const storage = new S3CompatibleStorageAdapter(
    createAwsS3Store(resolved.config),
    resolved.config.driver,
  );
  const result = await runStorageRoundtrip(storage);
  console.log(
    JSON.stringify(
      {
        ok: true,
        driver: result.driver,
        bucket: resolved.config.bucket,
        key: result.key,
        byteSize: result.byteSize,
        deleted: result.deleted,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown storage roundtrip error";
  console.error(message);
  process.exit(1);
});
