# Closed-beta backup and monitoring

Ops-side minimum for a 20–100 user invite beta. SpendGuard is ops-only and must never feed Director / Story / Timeline.

## Postgres

- Daily automated snapshot (provider disk snapshot or `pg_dump`).
- Retain at least 7 daily snapshots.
- Store snapshots off-box (another region or object store).

### Restore drill

1. Provision a scratch database.
2. Restore the latest snapshot.
3. Confirm `user`, `project`, `job`, `gateway_spend_ledger`, and `ai_processing_consent` row counts.
4. Confirm a known project’s media keys still resolve in the object store.
5. Record the drill date. Repeat after any storage-driver change.

## Object store (R2 / S3)

Set `STORAGE_DRIVER=r2` (preferred) or `s3` with versioning enabled on the bucket.

Recommended:

- Object versioning on
- Cross-region or same-provider replication for the beta bucket
- Lifecycle: keep noncurrent versions ≥ 7 days

Local disk (`STORAGE_DRIVER=local`) is not a production beta store.

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
