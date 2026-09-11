# Wave 1 — Closed-Beta Architecture / Impl Plan (APPROVE candidate)

**Status:** Architecture + impl plan only — **NOT** a PHASE lock. Does **not** amend M3–M8 creative semantics.  
**Authority:** Brett Wave 0 COMPLETE + W0-6 AUTHORIZED Wave 1 Beta.must (`PO_WAVE0_CLOSED_BETA_2026-09-10.md`).  
**Baseline tip:** `2a7939c` (at Wave 0 lock).  
**Constraints:** No paid generation expansion; no Creative Director interrupt; provider-neutral; HOLD docs-place until this plan APPROVE then package with CoS synthesis + ARCH_TRACK2/3.

---

## 1. Principle check — NO CONFLICT

| Wave 0 lock | Constitution / M8 / creative locks | Verdict |
|-------------|--------------------------------------|---------|
| Invite-only temporary; public free tier unchanged | Free tier = entitlement gates, not creative fork | **PASS** |
| Entitlement-gate all paid/vendor paths | D5 enforcement at gates, not inside compose ports | **PASS** |
| Durable spend caps before live keys | Engine economics ≠ creative decisions; ops fail-closed | **PASS** |
| Prod StoragePort before beta traffic | StoragePort swap; MediaAsset sacredness preserved | **PASS** |
| Consent before third-party AI | Never-train-by-default honesty; not CreativePlan field | **PASS** |
| Delete/GC **or** documented wipe | PrivacyLifecycle soft name; either-or OK for beta | **PASS** |
| Moderation accept under invite-only+ToS+known users | W0-5; revisit if circle expands | **PASS** |

**No new architectural principle. No M3–M8 creative semantic change required.**

---

## 2. Wave 1 scope (ordered checklist)

### W1.1 — Invite gate (YF-B02 / W0-1)
- **Arch:** `InviteGate` / account lifecycle: public `sign-up` **disabled** in beta config; allowlist emails and/or single-use invite codes (open string `inviteCode`, hashed at rest).
- **Locus:** Better Auth sign-up route + optional `Invitation` table (YouFlicks-owned) — **not** CreativePlan.
- **Tests:** Uninvited cannot create account; invited + verified can enter free path.
- **Impl note:** Feature flag `BETA_INVITE_ONLY=true` fail-closed in production beta.

### W1.2 — Durable SpendGuard (B-ABU-03 / YF-B05 / W0-2)
- **Arch:** Replace process-local-only caps with **durable** ledger (DB row or Redis with persistence) keyed by process/env + `providerKey`/capability window.  
  `assertWithinCap` **fail-closed** when `backend ≠ mock` and `MAX_JOBS`/`MAX_SPEND_USD` unset or invalid.
- **Locus:** Gateway process (+ optional app-side EngineCost rollup read). Still **ops-only** — never feeds Director.
- **Tests:** Unset caps on replicate/fal → refuse start; restart does not reset accepted spend; cross-process double-spend blocked or serialized.
- **Defaults for beta:** Brett prior `$8` / `10` jobs unless PO file updates.

### W1.3 — `requireGeneration` / entitlement on ALL paid/vendor paths (YF-B01 / B-QUO-04 / W0-2)
- **Arch:** Single `authorizeGeneration` (or equivalent) gate before enqueue of any job that can call a **vendor-backed** or **paid-capability** path: at minimum `AI_DIRECT`, `AI_STORY`, `AI_TIMELINE`, `AI_ASSET`, `MEDIA_ANALYZE` (when HTTP vision configured), and any future vendor render.  
  Local-deterministic-only adapters may remain gated by `*_ALLOW_LOCAL` (already non-prod) but **must not** bypass emailVerified / invite / abuse quarantine.
- **Locus:** Service enqueue methods / workers — **outside** port creative contracts.
- **Tests:** `emailVerified:false` fails Analysis/Story/Timeline/Asset/Render enqueue (not only Director); second free gen in hour denied consistently.
- **Explicit:** Free-tier meter boundary remains product “movie generation” honesty; do not invent new CreativePlan fields.

### W1.4 — StoragePort production object storage (B-STOR-01)
- **Arch recommendation:** **S3-compatible** adapter behind existing `StoragePort` (`put`/`get`/`delete`/exists). Prefer **Cloudflare R2** or **AWS S3** — Eng choice by ops cost/egress; **Architect: R2 default suggestion** (S3 API, no egress fees typical) unless Brett infra prefers AWS.
- **Config:** `STORAGE_DRIVER=s3` | `r2` + endpoint/bucket/credentials via env — **not** Prisma enums.
- **Tests:** Round-trip put/get/delete; Media/GeneratedAsset/Render/FinishedMovie keys opaque; no vendor URLs as storageKey.
- **Before beta traffic:** All new writes to object store; migration of local pilot bytes optional/ops.

### W1.5 — Email (YF-B03)
- **Arch (either-or for Wave 1):**  
  **A)** Real `VerificationEmailPort` adapter (Resend/SES/etc. — open `providerKey`), **or**  
  **B)** Pre-verified invite-only accounts (ops sets `emailVerified` at invite mint; public verify mail unused).  
- **Architect preference:** **B for first invites** (fast), schedule **A** same Wave 1 if mail provider ready — do not block invite mint on A if B is honest.
- **Tests:** Match chosen path; no log-only adapter in production beta config.

### W1.6 — Consent gate (W0-3 / YF-B04)
- **Arch:** Before first vendor upload / HTTP vision / gateway generate for a user: require accepted `AiProcessingConsent` record (versioned open string `policyVersion`, `acceptedAt`). Block server enqueue to vendor paths until accepted.
- **Locus:** Account/privacy service — **not** CreativePlan JSON. UI checkbox/link to policy; **legal text not invented here** (placeholder version `beta-ai-v1` until legal supplies).
- **Tests:** Without consent, AI_ASSET/HTTP analysis denied; with consent, allowed subject to entitlements.

### W1.7 — Deletion: wipe vs M8.8-lite (W0-4 / B-PRIV-01)
- **Architect recommendation for Wave 1 minimum:** **Documented beta wipe procedure + SLA** (ops runbook: DB truncate/cascade for invitee + StoragePort prefix delete; on-call target ≤24h).  
- **Parallel thin M8.8-lite (same Wave 1 if capacity):** owner `DELETE project` → cascade YouFlicks rows + StoragePort deletes for that project’s keys; account delete = all projects + auth rows.  
- **Do not block Wave 1 start** on full PrivacyLifecyclePort; wipe runbook is the Wave 1 must; M8.8-lite preferred before invite circle expands.
- **Provider-side:** checklist to delete/expire Replicate (or other) files where API allows — best-effort + honest copy.

### W1.8 — Backup + monitoring (B-BAK-01 / B-OBS)
- **Backup minimum:** Automated Postgres snapshots (daily) + object-store versioning or bucket replication; restore drill once before invites.  
- **Monitoring minimum:** Error tracker (e.g. Sentry) on app+gateway; alerts on job FAILED rate, gate DENY spikes, SpendGuard hits, storage errors. Structured logs → sink.  
- **Spend burn dashboard:** daily EngineCost + gateway spend vs cap.

### W1.9 — Should-fix (not Wave 1 blockers if invite-only)
- Share mint/open rate limits (YF-B10 MEDIUM under W0-1).  
- Gateway webhook secret fail-closed if webhook URL exposed.  
- Security headers (RT B11) — coordinate Red Team pass after PRs.

---

## 3. Explicit non-goals (Wave 1)

- Selective generation SG.* impl (Track 2 deferred).  
- I2V bake-off / multi-vendor premium routing (after caps+gates).  
- M8.5 paid checkout.  
- CreativePlan/Story/Timeline/Render **meaning** changes.  
- Permanent provider selection.  
- Full CSAM classifier (W0-5 accept).  
- Creative Director formal quality automation.

---

## 4. Suggested Eng slice order (PRs)

1. Invite gate + config fail-closed  
2. requireGeneration / entitlement on all vendor-capable enqueues (YF-B01)  
3. Durable SpendGuard fail-closed  
4. StoragePort S3/R2 adapter  
5. Consent record + enqueue block  
6. Email path A or B  
7. Wipe runbook (+ optional M8.8-lite project delete)  
8. Backup + monitoring wiring  
9. RT re-check tip → first human invite

Architect reviews each PR: APPROVE / APPROVE-with-fixes / BLOCK. Merge gated on CoS §8.

---

## 5. Docs-place

**HOLD** until this plan is APPROVE’d (Architect self-APPROVE below + CoS ACK). Then package:  
`COS_SYNTHESIS_NEXT_EXECUTION_2026-09-10.md` + `ARCH_TRACK2_*` + `ARCH_TRACK3_*` + this Wave 1 plan (all explicitly non-PHASE).

---

## 6. Architect verdict

**Self-APPROVE** Wave 1 plan as architecture-first impl guide under Wave 0.  
**No principle escalation.** Storage driver brand (R2 vs S3) = Eng/ops default to R2 unless Brett infra says otherwise. Consent legal copy = external. Soft Track 2 knobs remain deferred.
