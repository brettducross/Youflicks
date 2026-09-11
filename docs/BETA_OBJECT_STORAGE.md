# Production object storage (R2 / S3)

**Status:** Adapter + production refuse-local already on `main` (PR **#26**, tip includes `cae897d`). This page is the ops env matrix and verification checklist. It does **not** claim a live bucket was configured.

**Locks:** StoragePort swap only. Opaque keys remain domain truth. No M3–M8 creative change. Do not persist vendor CDN URLs.

Related: [LAUNCH_GATE_CHECKLIST.md](./LAUNCH_GATE_CHECKLIST.md) · [BETA_BACKUP_MONITORING.md](./BETA_BACKUP_MONITORING.md)

---

## What Eng already shipped (in-repo)

| Item | Where |
| --- | --- |
| `S3CompatibleStorageAdapter` behind `StoragePort` | `src/server/adapters/storage/s3.ts` |
| Production boot refuses `STORAGE_DRIVER=local` (including unset → local) | `assertProductionStorageDriver` in `src/lib/env.ts` |
| `r2` / `s3` require bucket + access key + secret | `src/lib/env.ts` |
| In-memory put/get/delete + opaque-key tests | `src/server/adapters/storage/s3.test.ts` |
| Live roundtrip helper (fail-closed without creds) | `scripts/verify-storage-roundtrip.ts` |

**Still Brett / ops:** create the bucket, turn versioning on, put credentials in the host secret store (never git), run the live roundtrip, sign the restore drill.

---

## Env matrix

Use the same `STORAGE_S3_*` names for both drivers. Driver is an open string (`r2` \| `s3`), not a Prisma enum.

### Cloudflare R2 (preferred)

R2 is S3-compatible, typically no egress fees, Architect default suggestion for closed beta.

| Variable | Required | Example shape (not real secrets) |
| --- | --- | --- |
| `STORAGE_DRIVER` | yes | `r2` |
| `STORAGE_S3_BUCKET` | yes | `youflicks-beta-media` |
| `STORAGE_S3_ENDPOINT` | yes | `https://<accountid>.r2.cloudflarestorage.com` |
| `STORAGE_S3_REGION` | yes (app default `auto`) | `auto` |
| `STORAGE_S3_ACCESS_KEY_ID` | yes | R2 API token access key |
| `STORAGE_S3_SECRET_ACCESS_KEY` | yes | R2 API token secret |
| `STORAGE_S3_FORCE_PATH_STYLE` | recommended `true` | `true` |

Replace `<accountid>` with the Cloudflare account id. Do not commit the token.

### Generic S3

| Variable | Required | Example shape (not real secrets) |
| --- | --- | --- |
| `STORAGE_DRIVER` | yes | `s3` |
| `STORAGE_S3_BUCKET` | yes | `youflicks-beta-media` |
| `STORAGE_S3_REGION` | yes | AWS region, e.g. `us-east-1` |
| `STORAGE_S3_ENDPOINT` | optional | omit for the provider default endpoint |
| `STORAGE_S3_ACCESS_KEY_ID` | yes | IAM access key |
| `STORAGE_S3_SECRET_ACCESS_KEY` | yes | IAM secret |
| `STORAGE_S3_FORCE_PATH_STYLE` | usually `false` on AWS | `false` |

### Local disk (dev/test only)

| Variable | Notes |
| --- | --- |
| `STORAGE_DRIVER=local` | Allowed in development/test. **Production boot refuses this**, including when the variable is unset (unset resolves to local). |
| `STORAGE_LOCAL_PATH` | Default `./storage` |

---

## Opaque keys (domain truth)

`StoragePort.put` returns a **key**. Persist that string on `media_asset.storageKey`, `generated_asset.storageKey`, `render_job.outputKey`, and `finished_movie.storageKey`.

- Keys look like `projects/<projectId>/assets/<id>/original.png` (or similar prefixes). They are **not** URLs.
- Vendor CDN / `https://…` strings are **not** domain truth. Adapters reject `://` and path escape (`..`) as keys.
- Playback, Keep, wipe, and restore all resolve bytes through StoragePort using those opaque keys.

The live roundtrip helper writes under `ops/verify-roundtrip/…` so it never collides with project media. Safe to delete.

---

## Versioning (required before invites)

Object-store versioning (or equivalent noncurrent retention) is a **launch-gate** item, not optional polish.

1. Enable **object versioning** on the beta bucket (R2 bucket setting or S3 versioning `Enabled`).
2. Keep noncurrent versions **≥ 7 days** (lifecycle). Cross-region / same-provider replication is recommended, not a code change.
3. Confirm in the restore drill ([BETA_BACKUP_MONITORING.md](./BETA_BACKUP_MONITORING.md) § numbered drill) that a known key still resolves after snapshot restore.

This document does **not** record that versioning was turned on. Ops must tick the checklist with evidence.

---

## Verify put / get / delete once credentials exist

**Do not put live credentials in the repo.** Load them from the host secret store or a local `.env` that is gitignored.

### 1. Fail-closed (no creds)

From a clean environment (no `STORAGE_S3_*`):

```bash
npx tsx scripts/verify-storage-roundtrip.ts
# or
npm run ops:verify-storage
```

**PASS:** process exits `1`, stderr explains r2|s3 + keys are required, **no** network call.

In-repo unit tests cover the same fail-closed resolver (`src/server/adapters/storage/roundtrip.test.ts`).

### 2. Live roundtrip (creds present)

```bash
STORAGE_DRIVER=r2 \
STORAGE_S3_BUCKET="…" \
STORAGE_S3_ENDPOINT="https://<accountid>.r2.cloudflarestorage.com" \
STORAGE_S3_REGION="auto" \
STORAGE_S3_ACCESS_KEY_ID="…" \
STORAGE_S3_SECRET_ACCESS_KEY="…" \
STORAGE_S3_FORCE_PATH_STYLE="true" \
npx tsx scripts/verify-storage-roundtrip.ts
```

**PASS:** JSON `{ ok: true, driver, bucket, key, byteSize, deleted: true }` and the disposable key is gone (`deleted: true`).

**FAIL:** non-zero exit. The helper attempts delete after a successful put even if get fails.

### 3. Ops checklist (sign in [LAUNCH_GATE_CHECKLIST.md](./LAUNCH_GATE_CHECKLIST.md))

- [ ] Bucket exists; public access blocked
- [ ] Versioning on; noncurrent ≥ 7 days
- [ ] App process has `STORAGE_DRIVER=r2` or `s3` + `STORAGE_S3_*` (no local)
- [ ] Fail-closed script exits 1 without creds
- [ ] Live script put/get/delete succeeded (date / operator recorded)
- [ ] No vendor URL stored as `storageKey` on a sample `media_asset` row after an ingest
