# Closed-beta wipe runbook

**SLA:** honor a deletion request within **24 hours**.  
**Scope:** Wave 1 M8.8-lite. This is not a full `PrivacyLifecyclePort`.

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
5. Delete the user (cascade) or the project:
   ```sql
   DELETE FROM project WHERE id = '<projectId>';
   -- or
   DELETE FROM "user" WHERE id = '<userId>';
   ```
6. Verify: no remaining rows for that user/project, and no leftover objects under `projects/<projectId>/`.

## Confirm

- [ ] Account or project is gone from Postgres
- [ ] Object-store prefixes for those projects are empty
- [ ] Record the request time and completion time (SLA ≤ 24h)
