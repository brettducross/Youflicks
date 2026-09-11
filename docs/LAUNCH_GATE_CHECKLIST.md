# Launch gate checklist — Wave 1 closed beta

**Purpose:** close what Eng can close in-repo, and make Brett’s remaining decisions **minimal and explicit**.  
**This file does not authorize invites.** Do not mint invites, do not set `BETA_INVITE_ONLY=false` on a hosted beta, do not invent counsel-approved legal text, do not weaken privacy / backup / storage / spend protections, do not amend M3–M8 locks.

**Tip hygiene:** branch from `main` including PR #26 (`cae897d` refuse-local + fail-closed share).  
**Related:** [BETA_OBJECT_STORAGE.md](./BETA_OBJECT_STORAGE.md) · [BETA_BACKUP_MONITORING.md](./BETA_BACKUP_MONITORING.md) · [BETA_AI_CONSENT_COPY_TEMPLATE.md](./BETA_AI_CONSENT_COPY_TEMPLATE.md) · [BETA_WIPE_RUNBOOK.md](./BETA_WIPE_RUNBOOK.md)

Copying `.env.example` is a **local/dev template**. Production must satisfy the PASS column below. Production boot already refuses `STORAGE_DRIVER=local` and `EMAIL_DRIVER=log` under invite-only; it does **not** invent a bucket or legal copy for you.

---

## How to use

1. Eng confirms in-repo rows (already shipped unless noted).
2. Brett / ops fills host secrets and ticks **Brett config** rows with evidence (date, operator).
3. Brett / counsel fills **Brett legal** rows (consent copy + `AI_CONSENT_POLICY_VERSION` bump).
4. Restore drill signed in [BETA_BACKUP_MONITORING.md](./BETA_BACKUP_MONITORING.md).
5. Only then: mint invites (out of scope for Eng on this PR).

---

## Required production flags

| Flag | PASS criteria | In-repo guard | Remaining owner |
| --- | --- | --- | --- |
| `BETA_INVITE_ONLY` | `true` **or unset**. Unset is fail-closed invite-only in production. **`false` opens public free-tier signup — forbidden for hosted closed beta.** | `resolveInviteOnly` | **Brett config:** do not set `false` on the host |
| `EMAIL_DRIVER` | `none` (Path B invite pre-verify). `log` is forbidden in production beta. Path A SMTP is not this wave. | Boot throws if `log` + invite-only production | **Brett config:** set `none` on the host (example file uses `log` for local DX only) |
| `BETA_OPS_SECRET` | Non-empty. Unset hides `/api/ops/*` as 404. Required so spend visibility and invite mint (when authorized) are not world-open. | Ops routes 404 without it | **Brett config:** set a long random secret in the host store |
| `STORAGE_DRIVER` | `r2` (preferred) or `s3` | Production refuses `local` / unset→local | **Brett config:** choose R2 vs S3 and create the bucket. See [BETA_OBJECT_STORAGE.md](./BETA_OBJECT_STORAGE.md) |
| `STORAGE_S3_BUCKET` + `STORAGE_S3_ACCESS_KEY_ID` + `STORAGE_S3_SECRET_ACCESS_KEY` | All set. R2 also needs `STORAGE_S3_ENDPOINT`. | Boot throws if r2\|s3 missing keys | **Brett config:** credentials in secret store, never git |
| `DATABASE_URL` (app) | Postgres URL on the Next.js process | Required by `src/lib/env.ts` | **Brett config:** hosted Postgres |
| `DATABASE_URL` (gateway) | Same durable DB on the **gateway process** when `YF_GATEWAY_BACKEND≠mock` | Live gateway fails closed without it (spend ledger) | **Brett config:** inject on gateway, not only the app |
| `YF_GATEWAY_API_KEY` | Shared bearer; same value as app `ASSET_HTTP_API_KEY`. Fail-closed if missing. | Gateway `assertGatewaySecrets` | **Brett config** |
| `YF_GATEWAY_MAX_JOBS` / `YF_GATEWAY_MAX_SPEND_USD` | Set explicitly. Live backends already apply beta defaults **10 / $8** if unset; uncapped live spend is fail-closed. Prefer explicit `10` / `8` unless Brett files a new number. | Gateway live caps | **Brett config:** confirm numbers; do not remove |
| Vendor token isolation | `REPLICATE_API_TOKEN` / `YF_GATEWAY_BACKEND_API_KEY` / `FAL_KEY` **on the gateway process only**. App `.env` must not hold vendor engine keys. | Designed; not a Prisma enum | **Brett config:** keep tokens off Next.js |
| `SHARE_TOKEN_SECRET` | **16+ characters** if share links are enabled; **empty / unset = share off** (fail-closed). No `BETTER_AUTH_SECRET` fallback. | `resolveShareSigningSecret` | **Brett config:** leave empty to keep share off for first invites, or set 16+ to enable |
| `DIRECTOR_ALLOW_LOCAL` `STORY_ALLOW_LOCAL` `TIMELINE_ALLOW_LOCAL` `ASSET_ALLOW_LOCAL` `RENDER_ALLOW_LOCAL` | Effectively **false** in production. Setting true is ignored (`NODE_ENV=production` forces false). | Forced false in `src/lib/env.ts` | Eng shipped. **Brett:** do not rely on local adapters in prod |
| `SENTRY_DSN` | Optional. When set, `ops.alert` also POSTs a Sentry store event (`JOB_FAILED`, `SPEND_GUARD`, `STORAGE_ERROR`). | Optional in env schema | **Brett config:** recommended, not a hard boot refuse |
| `AI_CONSENT_POLICY_VERSION` | Open string matching shipped consent copy. Default `beta-ai-v1` is a **placeholder**, not counsel-approved text. | Consent rows keyed by version | **Brett legal:** supply copy, then bump. See [BETA_AI_CONSENT_COPY_TEMPLATE.md](./BETA_AI_CONSENT_COPY_TEMPLATE.md) |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | 16+ secret; public origin of the app | Required | **Brett config** |

### Gateway listen (honesty)

Default `YF_GATEWAY_LISTEN_HOST=127.0.0.1`. Keep the gateway off the public internet. `/health` may include a spend snapshot — bind privately.

---

## Evidence (do not claim done in git)

| Check | PASS | Date | Operator |
| --- | --- | --- | --- |
| Host env matches the table above (screenshot or secret-store names only — **no secret values**) | | | |
| `npx tsx scripts/verify-storage-roundtrip.ts` fail-closed without creds | exit 1 | | |
| Live storage roundtrip with r2\|s3 creds | `{ ok: true, deleted: true }` | | |
| Restore drill signed in BETA_BACKUP_MONITORING.md | all numbered steps | | |
| Consent copy filled + version bumped | banner is no longer a legal placeholder | | |
| Invites minted | **out of scope until the rows above PASS** | | |

---

## Explicit non-actions (this wave)

- Do **not** open public registration (`BETA_INVITE_ONLY=false`).
- Do **not** mint invites from this checklist PR.
- Do **not** weaken spend caps, wipe SLA, opaque-key rules, or production local-storage refuse.
- Do **not** invent counsel-approved legal wording in the product UI.
- Do **not** change M3–M8 creative locks or run paid generation / bake-off.
