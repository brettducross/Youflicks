# Track 3 — Closed-Beta Readiness Assessment (Architect / Ops)

**Status:** Read-only launch-gap assessment — **NOT** a PHASE lock. Does **not** amend M3–M8.  
**Authority:** Brett-authorized via CoS 2026-09-10. Architect owns architecture/ops gaps.  
**Baseline:** origin/main `2a7939c` (creative M1–M7 CLOSED; free platform M8.1–M8.4+; R1 gateway CLOSED).  
**Scope:** Quiet closed beta ~20–100 users (Constitution). Web-first.  
**Coordination:** Red Team owns security/privacy/abuse deep-dive separately. **RT provisional CRITICAL/HIGH mapped in §3 (2026-09-10).** CoS synthesizes finals. No Creative Director interrupt. No code. No paid generation.

Severity: **CRITICAL** (beta-blocker) · **HIGH** (should fix before invite) · **MEDIUM** (mitigate / track) · **LOW** (backlog).

---

## 1. Executive summary

The product has a coherent CreativePlan→Share pipeline and free-tier **gates**, plus a provider-neutral video gateway. It is **not** yet production-hosted for 20–100 concurrent families.

**Beta blockers (Architect):** durable object storage beyond local disk; account/project deletion & retention/GC; production secrets/config posture (no local AI fakery; spend caps mandatory on live gateway); backup/recovery; basic ops monitoring/alerting; external-provider privacy/consent posture for Replicate (or any engine).

**Already in better shape:** email verification gate (M8.1); free-tier quota/duration/watermark/ads binding (M8.2–M8.4); share-link revoke + TTL (M7); open `providerKey` / no vendor Prisma enums; R1 authenticated file upload (no public hosts) on gateway.

---

## 2. Findings by theme

### 2.1 Production object storage

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-STOR-01 | `STORAGE_DRIVER` only `local`; no S3/R2 adapter behind `StoragePort` | **CRITICAL** | README/local adapter explicitly “swap later”. Multi-instance / durable beta needs object storage. |
| B-STOR-02 | Local paths on app disk — no CDN, no lifecycle policies | **HIGH** | Coupled to single host; loss on disk failure. |
| B-STOR-03 | Archive soft-deletes FinishedMovie without guaranteed byte GC | **MEDIUM** | M6 archive ≠ storage reclaim. |

### 2.2 Worker / concurrency hardening

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-JOB-01 | Postgres job queue exists; production multi-worker lease/heartbeat/poison-message policy not evidenced as hardened | **HIGH** | Risk: stuck RUNNING, double-claim under scale. |
| B-JOB-02 | Long video generations (5m timeout class) vs HTTP/worker timeouts | **HIGH** | Need worker-only execution (already pattern) + observability on stuck AI_ASSET/RENDER. |
| B-JOB-03 | Gateway job store is **in-memory** (R1 scaffold) | **HIGH** | Process restart loses gateway correlation; fine for pilot, weak for shared beta host. |
| B-JOB-04 | Concurrent SpendGuard not atomic across processes | **MEDIUM** | Caps are process-local placeholders. |

### 2.3 Quota / rate limiting

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-QUO-01 | Free 1 gen/hour + duration gates implemented (M8.2) | — | **Strength** |
| B-QUO-02 | Paid rails (M8.5b+) held — beta may be free-only | **MEDIUM** | OK if PO scopes free-only beta; document. |
| B-QUO-03 | Per-IP / edge rate limits beyond app RateLimitPort | **MEDIUM** | Cross-ref Red Team / edge. |

### 2.4 Free-tier abuse protection

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-ABU-01 | Abuse quarantine flag / basic signals exist (M8.2) | — | **Partial strength** |
| B-ABU-02 | Multi-account / disposable-email / residential proxy heuristics thin | **HIGH** | Cross-ref Red Team. |
| B-ABU-03 | Engine spend can burn cash if gateway caps unset | **CRITICAL** | R1 residual: set `YF_GATEWAY_MAX_JOBS`/`MAX_SPEND_USD` (Brett `$8`/`10`) **mandatory** on live. Prefer fail-closed when backend≠mock. RT YF-R01 overlap — treat as invite-blocker. |
| B-MOD-01 | Upload/prompt/output moderation thin for abuse/CSAM/PII paths | **HIGH** | RT-led; Architect: beta needs minimum policy gate before wide invite. |


### 2.5 Email verification

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-MAIL-01 | `emailVerified` gates generation (M8.1) | — | **Strength** |
| B-MAIL-02 | Verification email still log-adapter oriented in non-prod patterns | **HIGH** | Production needs real mail provider adapter + deliverability. |
| B-MAIL-03 | Resend / abuse of verification endpoints | **MEDIUM** | Cross-ref RT. |

### 2.6 Deletion / GC

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-PRIV-01 | `PrivacyLifecyclePort` designed in M8.8 — **not** shipped as full export/delete | **CRITICAL** | Closed beta still needs “delete my project/account” path + StoragePort deletes. |
| B-PRIV-02 | GeneratedAsset / render / library byte GC policy unclear | **HIGH** | Orphan keys on local/S3. |
| B-PRIV-03 | Provider-side retention (Replicate files/predictions) | **HIGH** | Contract + deletion story; cross-ref RT + PO. |

### 2.7 External-provider privacy / consent

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-EXT-01 | Constitution: never train on customer footage by default | **HIGH** | Need vendor DPA / settings confirmation before beta invites. |
| B-EXT-02 | Gateway holds `REPLICATE_API_TOKEN` — secret sprawl if colocated with Next | **HIGH** | Keep gateway process isolated (already designed). |
| B-EXT-03 | User consent copy for “send stills to video engine” | **HIGH** | Product/legal honesty; Architect flags as beta gate. |
| B-EXT-04 | YF-C01 https-only ad linkUrl | — | **Strength** (ads surfaces) |

### 2.8 Security headers

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-HDR-01 | No clear CSP/HSTS/frame-ancestors hardening in `next.config` from Architect skim | **HIGH** | Defer detail to Red Team; treat as beta checklist item. |

### 2.9 Share-link protection

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-SHR-01 | SHARE_LINK TTL + revoke + fingerprint (M7) | — | **Strength** |
| B-SHR-02 | Token brute-force / enumeration / referrer leakage | **MEDIUM** | Cross-ref RT. |
| B-SHR-03 | `SHARE_TOKEN_SECRET` empty disables share — fail-closed option exists | — | **Strength** if configured intentionally |

### 2.10 Session / revocation hardening

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-SES-01 | Better Auth sessions present | — | Baseline |
| B-SES-02 | Global logout / session revoke-all / stolen-cookie playbook | **HIGH** | Cross-ref RT; ops runbook needed. |
| B-SES-03 | Playback/share session store secrets rotation | **MEDIUM** | |

### 2.11 Monitoring / observability

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-OBS-01 | M8.7 ops/admin/observability **not** closed | **HIGH** | Need error tracking, job failure alerts, gate deny metrics. |
| B-OBS-02 | Structured logs exist; no evidenced prod sink (Sentry/etc.) | **HIGH** | |
| B-OBS-03 | EngineCost / spend dashboards for beta burn | **HIGH** | Prevent silent $ bleed. |

### 2.12 Backup / recovery

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-BAK-01 | No documented Postgres + object-storage backup/restore for beta | **CRITICAL** | |
| B-BAK-02 | RPO/RTO undefined | **HIGH** | PO/ops soft decision. |

### 2.13 Production configuration

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-CFG-01 | `*_ALLOW_LOCAL` forced false in production — good | — | **Strength** |
| B-CFG-02 | Production must configure real HTTP Director/Story/Timeline **or** accept limited creative path honesty | **HIGH** | Beta scope: define which stages are local-dev-only vs live. |
| B-CFG-03 | Gateway listen default `127.0.0.1` — correct for colocated; needs private network if split | **MEDIUM** | |
| B-CFG-04 | Health endpoint may expose backend/spend snapshot | **MEDIUM** | Residual from R1 review; bind privately. |

### 2.14 Operational failure handling

| ID | Finding | Sev | Notes |
|----|---------|-----|-------|
| B-OPS-01 | Typed AppErrors + fail-closed provider missing | — | **Strength** pattern |
| B-OPS-02 | User-visible recovery when AI_ASSET/RENDER fails mid-movie | **MEDIUM** | UX honesty / retry |
| B-OPS-03 | On-call / escalate path for beta | **HIGH** | Process, not code. |
| B-OPS-04 | Payment/billing incomplete — keep beta free-tier only unless M8.5 authorized | **MEDIUM** | Avoid half-wired checkout. |

---

## 3. Cross-reference — Red Team (FINAL tip `2a7939c`)

RT final CRITICAL/HIGH list received 2026-09-10. Tip of main: `2a7939ccd4fad9bc2f7f3341a400b45939f14999`.

**RT: no CRITICAL code findings.** Invite-blockers are HIGH (plus Architect ops CRITICALs below).

| Architect ID | RT ID | RT sev | Architect stance for CoS synthesize |
|--------------|-------|--------|-------------------------------------|
| B-QUO-04 | **YF-B01** | HIGH CONFIRMED | **HIGH invite-blocker** — `requireGeneration` only on Director; Analysis/Story/Timeline/Asset/Render ungated |
| *(new)* B-INV-01 | **YF-B02** | HIGH | **HIGH** — public sign-up / no invite-only posture (PO can accept invite-only mitigation) |
| B-MAIL-02 | **YF-B03** | HIGH | **HIGH** — LogVerificationEmailAdapter; gate only AI_DIRECT |
| B-EXT-* | **YF-B04** | HIGH | **HIGH** — vision/Replicate egress + face/location/transcript; no consent UX |
| B-ABU-03 | **YF-B05** | HIGH | Architect keeps **CRITICAL for live spend** until caps fail-closed non-mock; RT HIGH = same decision weight — PO/CoS pick label |
| B-PRIV-* / B-STOR-01 | **YF-B06** | HIGH | RT HIGH on delete/GC/local storage; Architect keeps **CRITICAL** on missing prod StoragePort + delete/GC for hosted beta |
| B-MOD-01 | **YF-B07** | HIGH | **HIGH** — zero moderation; accept only if invite-only + known users |
| B-SHR-02 | **YF-B10** | MEDIUM (RT) | CoS reconcile: RT “should fix” if invite-only; Architect had HIGH for scraping — **defer to CoS** (invite-only → MEDIUM OK) |
| B-HDR / B-SES / B-CFG / health | B11/B13/B16/B17/B19 | MEDIUM | Align MEDIUM pack |

**CLOSED (do not re-open):** YF-038*, YF-C01.

**Architect remaining CRITICAL pack for hosted invite (ops, not RT “code CRITICAL”):** B-STOR-01 (object storage), B-BAK-01 (backup/restore), B-ABU-03 (mandatory spend caps on live gateway). These are launch-hosting gates even when RT finds no CRITICAL code bug.

CoS may synthesize now.

## 4. Suggested beta minimum (Architect)

**Must before invites (CRITICAL/HIGH pack):**

1. S3-compatible `StoragePort` adapter + prod bucket IAM.  
2. Mandatory live gateway spend caps (fail-closed if unset for non-mock).  
3. Real email delivery for verification.  
4. Account/project delete + storage GC path (even if thin M8.8 slice).  
5. Backups for DB + object store.  
6. Error tracking + alert on job/gate/spend anomalies.  
7. Written privacy blurb + vendor non-train confirmation.  
8. Red Team sign-off on CRITICAL security items.

**Can defer to early beta with mitigation:** full M8.5 paid rails; multi-region; advanced abuse ML; SIMPLE_MOTION polish; Creative Director formal gate automation.

---

## 5. Milestone candidates (ops — not authorized here)

| ID | Theme |
|----|-------|
| **BETA.1** | Production StoragePort (S3/R2) |
| **BETA.2** | Gateway HA + durable job correlation + mandatory caps |
| **BETA.3** | PrivacyLifecycle thin slice (export/delete/GC) |
| **BETA.4** | Observability + spend burn alerts (M8.7 slice) |
| **BETA.5** | Email provider adapter |
| **BETA.6** | Backup/restore runbook drill |
| **BETA.7** | RT remediation sprint |

---

## 6. Escalations to PO

1. Confirm **free-only** closed beta (no M8.5 checkout).  
2. Acceptable engine budget ceiling per user / per day beyond R1 `$8`/`10`.  
3. Vendor privacy / training contractual bar.  
4. Whether beta requires full account deletion day-1 vs project-delete-only.

No new creative-pipeline principle required for this assessment.

---

## 7. Architect stance

Closed beta is **architecturally coherent** on the creative + free-tier path, **operationally incomplete** for production hosting. Treat B-STOR-01, B-ABU-03, B-PRIV-01, B-BAK-01 as merge-gates for invite. Coordinate remaining security severity with Red Team via CoS.
