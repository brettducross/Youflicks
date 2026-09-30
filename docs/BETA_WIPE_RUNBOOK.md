# Closed-beta wipe runbook

**SLA:** honor a deletion request within **24 hours**.  
**Scope:** Wave 1 M8.8-lite. This is not a full `PrivacyLifecyclePort`.  
**Related:** [LAUNCH_GATE_CHECKLIST.md](./LAUNCH_GATE_CHECKLIST.md) · [BETA_BACKUP_MONITORING.md](./BETA_BACKUP_MONITORING.md)

## Product path (preferred)

Signed-in owner:

1. Delete one project: `DELETE /api/projects/:projectId`
2. Delete the whole account: `DELETE /api/me/account`

Both collect opaque StoragePort keys (media, generated assets, render outputs, library keeps), delete the DB row (cascade), then `StoragePort.delete` each key. Failures emit `ops.alert` / `STORAGE_ERROR`.

## Ops path (if the product path is unavailable)

1. Identify the user:
   ```sql
   SELECT id, email FROM "user" WHERE email = '<email>';
   ```
2. List projects:
   ```sql
   SELECT id, title FROM project WHERE "ownerId" = '<userId>';
   ```
3. Collect storage keys:
   ```sql
   SELECT "storageKey", "previewKey" FROM media_asset WHERE "projectId" IN (...);
   SELECT "storageKey", "previewKey" FROM generated_asset WHERE "projectId" IN (...);
   SELECT "outputKey" FROM render_job WHERE "projectId" IN (...);
   SELECT "storageKey" FROM finished_movie WHERE "projectId" IN (...);
   ```
4. Delete objects in the configured store (`STORAGE_DRIVER=local` path, or R2/S3 bucket) using those opaque keys. Never treat vendor CDN URLs as truth.
5. Delete AI-video budget ledgers, then the user (cascade) or the project.
   Project delete cascades `ai_video_budget_reservation` rows. Ledger rows are not foreign-keyed, so purge them explicitly. User-window rows are keyed by `userId`.
   Project delete also cascades `shot_fulfillment` rows, and those cascade `shot_fulfillment_attempt` rows. There is no user-keyed fulfillment table to purge separately.
   ```sql
   DELETE FROM ai_video_budget_ledger WHERE "projectId" = '<projectId>';
   DELETE FROM project WHERE id = '<projectId>';
   -- or, for the whole account:
   DELETE FROM ai_video_budget_ledger WHERE "userId" = '<userId>';
   DELETE FROM ai_video_budget_ledger WHERE "projectId" IN ('<projectId>', ...);
   DELETE FROM "user" WHERE id = '<userId>';
   ```
6. Verify: no remaining rows for that user/project (including `ai_video_budget_ledger`, `shot_fulfillment`, and `shot_fulfillment_attempt`), and no leftover objects under `projects/<projectId>/`.

## Confirm

- [ ] Account or project is gone from Postgres, including `shot_fulfillment` and `shot_fulfillment_attempt`
- [ ] Object-store prefixes for those projects are empty
- [ ] Record the request time and completion time (SLA ≤ 24h)

## Evidence

Host-filled record for one deletion request. Engineering must not claim READY from this runbook. Unfilled `_fill_` means the wipe drill is **not** signed.

| Field | Value |
| --- | --- |
| Request time (PT) | `_fill_` |
| Completion time (PT) | `_fill_` |
| Operator | `_fill_` |
| Project or account id (non-secret) | `_fill_` |
| Storage GC attempted / deleted (counts, or see logs) | `_fill_` |
| Sign-off | `_fill_` |

Unfilled `_fill_` means this wipe drill is **not** signed. Do not claim READY because project/account delete and StoragePort GC already exist in code. This table does not state provider-side retention. `npm run ops:check-launch-evidence` stays exit 1 while any placeholder cell remains. That command does not authorize invites.
