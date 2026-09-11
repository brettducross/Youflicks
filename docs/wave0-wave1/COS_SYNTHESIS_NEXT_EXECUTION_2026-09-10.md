# Chief of Staff Synthesis — Next Execution Sequence
**Date:** 2026-09-10 (PT)  
**Inputs (independent):**
- Track 1: `CONSUMER_UX_SPEC_BOUNDED_2026-09-10.md` (Parent Simulator evidence)
- Track 2: `ARCH_TRACK2_SELECTIVE_GENERATION_PROPOSAL.md` sha `bbeaafe3…`
- Track 3 Architect: `ARCH_TRACK3_CLOSED_BETA_READINESS.md` sha `8d93bd55…` (RT FINAL tip cross-ref)
- Track 3 Red Team FINAL: tip `2a7939ccd4fad9bc2f7f3341a400b45939f14999` (YF-B01…B22)
**Constraints honored:** Creative Director not interrupted; no paid generation; no M3–M8 lock edits in these tracks.

---

## Bottom Line

Three reports are coherent. **Do not invite 20–100 users yet.** Creative M1–M7 + free-tier M8.1–M8.4 + R1 gateway prove the engine path; they do **not** make open registration + live vendor keys + family-photo egress + missing delete safe.

**Recommended sequence (priority order):**
1. **PO launch decisions** (blockers) — invite-only, spend-cap fail-closed, consent/training honesty, deletion SLA
2. **Beta.must engineering** — storage, durable caps, gate all paid paths, email delivery, invite gate
3. **UX-C1** — consumer parent path (docs ready; fix YF-UX-001 class dead-ends)
4. **SG.0→SG.4** — selective generation (cost/cinematic ROI) once spend gates are honest
5. Hold broader SG.5–7 / paid commercial polish until beta posture is accepted

Creative Director evaluation of the 25s mini-movie remains an independent quality gate — do not conflate with beta launch.

---

## Situation (FACT)

| Track | Status | Key deliverable |
|-------|--------|-----------------|
| 1 UX | COMPLETE docs-only | Parent path + labels; UX-C1 candidate; YF-UX-001 → PM |
| 2 Selective gen | COMPLETE proposal | SelectiveGenerationPolicy at fulfillment; SG.0–SG.7; no principle escalation |
| 3 Beta | COMPLETE Arch+RT | Tip `2a7939c`; Architect CRITICAL pack + RT HIGH YF-B01…B07 |

**Strengths already shipped:** M8.1 emailVerified gate on AI_DIRECT; M8.2–4 free quotas/watermark/ads; M7 share TTL/revoke; YF-C01 https ad links; R1 authenticated uploads; provider-neutral ports.

---

## Analysis

### A. Closed-beta invite blockers (reconciled)

| Priority | ID | Source | Severity (CoS) | Issue |
|----------|-----|--------|----------------|-------|
| P0 | Invite posture | RT YF-B02 + Constitution | **CRITICAL (PO)** | Public `/sign-up` vs quiet 20–100 beta |
| P0 | Spend caps | Arch B-ABU-03 / RT YF-B05 / YF-R01 | **CRITICAL** | Caps optional + process-local; fail-closed required when backend≠mock |
| P0 | Ungated jobs | RT YF-B01 / Arch B-QUO-04 | **CRITICAL for live keys** | Only Director compose hits requireGeneration; analyze/story/timeline/asset/render can burn vendor |
| P0 | Family photo egress | RT YF-B04 / Arch B-EXT-* | **HIGH→PO** | Vision + R1 Replicate without consent UX / DPA honesty |
| P0 | Delete/GC | Arch B-PRIV-01 / RT YF-B06 | **CRITICAL ops** | No PrivacyLifecycle; local storage only (B-STOR-01); soft archive |
| P0 | Backup | Arch B-BAK-01 | **CRITICAL ops** | No backup/restore story |
| P1 | Email delivery | RT YF-B03 / B-MAIL-02 | **HIGH** | Verification log-adapter; gate inert without mailer or pre-verify invites |
| P1 | Moderation | RT YF-B07 / B-MOD-01 | **HIGH** | Acceptable **only if** invite-only + known users + ToS; else blocker |
| P1 | Share rate limits | Arch B-SHR-02 vs RT YF-B10 | **MEDIUM if invite-only** | CoS: defer to MEDIUM under invite-only; raise if public sign-up |
| P2 | Headers, open redirect, health recon, webhook fail-open, etc. | RT YF-B11–B19 | MEDIUM–HIGH | Bundle into Beta hardening sprint |

**INFERENCE:** Live Replicate/fal keys + public sign-up + ungated job paths is an unacceptable combination (RT YF-B30).

### B. UX (Track 1)

Parent Simulator CRITICAL: no single “Make my movie”; YF-UX-001 dead-end after plan READY. Spec is ready for a dedicated **UX-C1** milestone — docs only today. Does not require PO principle change; PM owns YF-UX-001.

### C. Selective generation (Track 2)

Correct boundary: policy outside CreativePlan/Story/Timeline; commercial = gate/defer only. **SG.2 (budget binding) should follow durable spend caps** — otherwise policy cannot honestly degrade. Premium density / own-footage-only remain soft PO knobs (§7), not blockers for drafting SG.0.

### D. What not to do now

- Do not run more paid generation pending CD evaluation + spend posture.
- Do not amend M3–M8 locks for these tracks.
- Do not treat informal Malecón QA or 25s mini-movie as finished-movie approval.
- Do not docs-place Track 2/3 as PHASE locks without Brett/Architect lock ceremony.

---

## Recommendation — Execution sequence

### Wave 0 — Product Owner decisions (escalate now)
1. **Invite-only closed beta?** Disable public sign-up / allowlist / invite codes (YF-B02 / YF-B30).
2. **Live vendor keys in beta?** Only if (1) + durable fail-closed spend caps + gated job paths.
3. **Consent / never-train honesty** for family photos to third-party AI (YF-B04 / YF-B31).
4. **Deletion SLA:** ship M8.8-lite before invites, or accept written beta exit/ops wipe runbook (YF-B06).
5. **Moderation:** accept invite-only risk vs require safety gate (YF-B07).
6. Soft (non-blocking for Wave 1): Track 2 §7 premium density / own-footage-only / cost honesty UX.

### Wave 1 — Beta.must (engineering; authorize separately)
Order:
1. **B-ABU-03 / YF-B05** — Mandatory gateway spend caps fail-closed when backend≠mock; durable/shared counter (not process-local only).
2. **YF-B01 / B-QUO-04** — `requireGeneration` (email+quota/concurrency) on every paid capability path (analyze/story/timeline/asset/render as applicable).
3. **YF-B02** — Invite-only / disable public sign-up (after PO).
4. **B-STOR-01** — S3/R2 (or equiv) behind StoragePort.
5. **YF-B03** — Real VerificationEmailPort **or** pre-verified invites only.
6. **YF-B04** — Consent UX + server block until accepted; vendor DPA/retention checklist.
7. **B-PRIV-01 / YF-B06** — Account/project delete + storage GC **or** ops runbook with SLA (per PO).
8. **B-BAK-01** — Backup/restore minimum.
9. Monitoring/spend alerts; webhook secret fail-closed if exposed (YF-B19); share mint rate limits (B-SHR-02).

Red Team sign-off on CRITICAL/must-accept list before first invite.

### Wave 2 — UX-C1 Consumer Parent Path
Implement bounded spec (not full redesign): single Make my movie path; fix YF-UX-001 unlock/plain blockers; replace phase/ports/schema chrome with parent labels; Keep/Share/Download trust copy. Parent Simulator re-walk after.

### Wave 3 — Selective Generation SG.0 → SG.4 → SG.2 → SG.3
Architecture proposal APPROVED as direction. Impl only after Wave 1 spend honesty. Then SG.5–SG.7 / UX honesty for premium moments.

### Parallel (non-blocking)
- Creative Director continues mini-movie evaluation undisturbed.
- Economics telemetry for exact prices remains separate from creative meaning.
- Docs-place of Track 1–3 artifacts on main = optional ceremony (proposal docs, not PHASE locks).

---

## Action

| Owner | Action | Wait on |
|-------|--------|---------|
| **Brett (PO)** | Decide Wave 0 items 1–5 | — |
| CoS | Hold invites; no paid gen expansion; schedule Wave 1 Eng after PO | Wave 0 |
| Architect | Ready SG.0 contract draft when Eng authorized; advise StoragePort adapter choice | PO/CoS |
| Red Team | Re-check tip after Wave 1 PRs | Wave 1 |
| PM / Eng | YF-UX-001 + UX-C1 after or overlapping late Wave 1 | Spec done |
| Creative Director | Continue 25s evaluation (no interrupt) | — |

**No new architectural principle required** for selective generation. **PO/legal judgment required** for invite posture, photo egress consent/training, and deletion SLA.

---

## Addendum — Architect RT FINAL (2026-09-10)

- Tip `2a7939c` cross-ref complete. Track 3 sha `8d93bd55…`.
- RT: no CRITICAL *code* findings; Architect retains **ops CRITICAL**: B-STOR-01, B-BAK-01, B-ABU-03/YF-B05.
- **HOLD docs-place** until Brett Wave 0; later package synthesis + ARCH_TRACK2/3 as non-PHASE proposals only.

---

## Addendum — Wave 0 lock (2026-09-10)

**W0-1 LOCKED:** Invite-only closed beta — disable public sign-up / allowlist (Brett).  
Source: `PO_WAVE0_CLOSED_BETA_2026-09-10.md`. W0-2…W0-6 still open.

---

## Addendum — Wave 0 COMPLETE (2026-09-10 evening)

Brett expanded **W0-1** (invite-only + full beta-path requirements) and directed CoS to finish remaining Wave 0 with minimal escalation.

**LOCKED:** W0-1…W0-5 as in `PO_WAVE0_CLOSED_BETA_2026-09-10.md`.  
**AUTHORIZED:** W0-6 Wave 1 Beta.must engineering checklist.  
Invite-only = temporary; public free-tier model unchanged (email, 1/hr, 5 min, watermark, ads).
