# Closed-beta backup and monitoring

Ops-side minimum for a 20–100 user invite beta. SpendGuard is ops-only and must never feed Director / Story / Timeline.

**This runbook is a checklist. It does not claim a drill was completed.** Sign the evidence block in §4 before minting invites. Related: [LAUNCH_GATE_CHECKLIST.md](./LAUNCH_GATE_CHECKLIST.md) · [BETA_OBJECT_STORAGE.md](./BETA_OBJECT_STORAGE.md) · [BETA_WIPE_RUNBOOK.md](./BETA_WIPE_RUNBOOK.md)

## Postgres

- Daily automated snapshot (provider disk snapshot or `pg_dump`).
- Retain at least 7 daily snapshots.
- Store snapshots off-box (another region or object store).

## Object store (R2 / S3)

Set `STORAGE_DRIVER=r2` (preferred) or `s3` with **versioning enabled** on the bucket. See [BETA_OBJECT_STORAGE.md](./BETA_OBJECT_STORAGE.md).

Recommended:

- Object versioning on
- Cross-region or same-provider replication for the beta bucket
- Lifecycle: keep noncurrent versions ≥ 7 days

Local disk (`STORAGE_DRIVER=local`) is not a production beta store. Production boot refuses it.

## Alerts

Set `SENTRY_DSN` on the app and gateway processes. Code emits `ops.alert` and optionally a Sentry store event for:

| Kind | When |
| --- | --- |
| `JOB_FAILED` | Terminal job failure (no retry left) |
| `SPEND_GUARD` | Live gateway cap hit |
| `STORAGE_ERROR` | Object-store put/delete/GC failure |

Also tail JSON logs for `entitlement.generation_denied`, `jobs.fail`, `yf_asset_gateway`, and `storage.*`.

## Spend vs cap

- Gateway `GET /health` includes a spend snapshot (keep the gateway off the public internet).
- Durable counters: table `gateway_spend_ledger` id `yf-asset`.
- App ops: `GET /api/ops/spend` with `Authorization: Bearer $BETA_OPS_SECRET`.

Live backends (`YF_GATEWAY_BACKEND≠mock`) apply beta defaults **10 jobs / $8** when `YF_GATEWAY_MAX_JOBS` / `YF_GATEWAY_MAX_SPEND_USD` are unset. Uncapped live spend is fail-closed. Restart must not reset the ledger (`DATABASE_URL` required on the gateway process).

---

## Numbered restore drill (required before invites)

Run against a **scratch** restore target. Do not overwrite production. Record evidence in §4. Do not tick PASS without observing the result.

**Target RPO / RTO (Brett fills before the drill):**

| Target | Value | Notes |
| --- | --- | --- |
| RPO (max acceptable data loss) | `_fill_` | Snapshot schedule must be at least this tight |
| RTO (max acceptable restore time) | `_fill_` | Clock starts at “declare restore” |

### 1. Capture pre-restore counts on production (read-only)

```sql
SELECT
  (SELECT count(*) FROM "user") AS users,
  (SELECT count(*) FROM project) AS projects,
  (SELECT count(*) FROM job) AS jobs,
  (SELECT count(*) FROM beta_invite) AS invites,
  (SELECT count(*) FROM ai_processing_consent) AS consents,
  (SELECT count(*) FROM gateway_spend_ledger) AS spend_ledger_rows;

SELECT id, "jobsAccepted", "spendUsd", "updatedAt"
FROM gateway_spend_ledger
WHERE id = 'yf-asset';
```

Pick **one known project id** and note a media key that must still resolve:

```sql
SELECT id, "storageKey", "previewKey" FROM media_asset WHERE "projectId" = '<projectId>';
SELECT id, "storageKey", "previewKey" FROM generated_asset WHERE "projectId" = '<projectId>';
SELECT id, "outputKey" FROM render_job WHERE "projectId" = '<projectId>';
SELECT id, "storageKey" FROM finished_movie WHERE "projectId" = '<projectId>';
```

Keys are opaque StoragePort strings, not vendor URLs.

### 2. Provision a scratch Postgres

Create an empty database (or a throwaway instance). Do not point the live app at it yet.

### 3. Restore the latest Postgres snapshot into the scratch database

Use the provider’s snapshot restore **or**:

```bash
# Example only — operator substitutes the real snapshot file from the backup store.
pg_restore --clean --if-exists --no-owner --dbname="$SCRATCH_DATABASE_URL" "$SNAPSHOT_FILE"
# or
psql "$SCRATCH_DATABASE_URL" < "$SNAPSHOT_SQL"
```

Clock **RTO start** when restore begins; **RTO stop** when §6 PASSes.

### 4. Confirm tables that must survive

On the **scratch** database, the following must be present with counts that match the snapshot (or an explained delta):

| Table | Why it must survive |
| --- | --- |
| `gateway_spend_ledger` | Durable spend vs cap (`yf-asset` row). Restart must not zero this. |
| `ai_processing_consent` | Vendor enqueue stays gated to accepted policy versions. |
| `beta_invite` | Invite allowlist / hashed codes. Lost rows = phantom invitees or open holes. |
| `project` | Studio projects. |
| `media_asset` / `generated_asset` / `render_job` / `finished_movie` | Opaque media keys that StoragePort must still resolve. |
| `"user"` | Owners for projects, consents, invites. |

Re-run the count queries from step 1 against scratch. **FAIL** if `gateway_spend_ledger`, `ai_processing_consent`, `beta_invite`, or project/media key tables are missing or empty when production was not.

### 5. Object-store versioning check

This is independent of Postgres restore. Confirm the **production** bucket (R2 preferred / S3):

1. Versioning is **Enabled** (provider console or API). Lifecycle keeps noncurrent versions ≥ 7 days.
2. For the known opaque key from step 1, `StoragePort.get` (or provider GetObject) returns bytes.
3. Optional overwrite drill: put a disposable `ops/verify-roundtrip/…` object, overwrite it, list versions, restore the prior version, then delete the disposable key. `npm run ops:verify-storage` covers put/get/delete only — versioning itself is a bucket setting.

**FAIL** if versioning is Off, or if the known project key 404s while the Postgres row still points at it.

### 6. Confirm a known project’s media keys still resolve

Using scratch DB metadata + the **real** object store (keys are in the bucket, not in the SQL dump):

- [ ] `media_asset.storageKey` get succeeds
- [ ] `generated_asset.storageKey` get succeeds (if the sample project had one)
- [ ] `finished_movie.storageKey` get succeeds (if kept)
- [ ] No key is a `https://` vendor URL

### 7. Tear down scratch

Drop the scratch database. Do not leave a restored copy on a public network. Do not promote scratch over production unless this was a real incident and Brett authorized it.

### 8. Repeat triggers

Repeat this numbered drill after any `STORAGE_DRIVER` change, bucket migration, or Postgres provider change.

---

## Evidence (sign before invites)

| Field | Value |
| --- | --- |
| Drill date (UTC) | `_fill_` |
| Operator | `_fill_` |
| Snapshot identifier / timestamp | `_fill_` |
| Target RPO | `_fill_` |
| Observed RPO (age of snapshot used) | `_fill_` |
| Target RTO | `_fill_` |
| Observed RTO (restore start → step 6 PASS) | `_fill_` |
| `gateway_spend_ledger` survived | yes / no |
| `ai_processing_consent` survived | yes / no |
| `beta_invite` survived | yes / no |
| Project + media keys resolved | yes / no |
| Object versioning confirmed | yes / no |
| Sign-off (Brett or delegated ops) | `_fill_` |

Unfilled `_fill_` means the drill is **not** signed. Do not treat a merged PR as a completed restore.
