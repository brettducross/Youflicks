# Product Owner — Wave 0 Closed-Beta Decisions
**Date:** 2026-09-10 (PT)  
**Authority:** Brett Ducross (PO) via CoS.  
**Synthesis:** `COS_SYNTHESIS_NEXT_EXECUTION_2026-09-10.md`

## Product model (unchanged)

**Eventual public free tier remains:**
- valid email
- 1 AI_DIRECT movie-generation attempt/hour
- maximum 5 minutes
- watermark
- advertising

**Invite-only is a temporary launch posture**, not a change to the eventual public product model.

---

## W0-1 LOCKED — Invite-only closed beta (expanded)

**Closed beta = INVITE-ONLY. Do not open public registration yet.**

### Beta-path requirements (LOCKED)

| # | Requirement |
|---|-------------|
| 1 | Invitation required (disable public sign-up; invite code and/or allowlist) |
| 2 | Valid email required |
| 3 | All paid/vendor-backed generation paths entitlement-gated |
| 4 | Durable spend controls before live vendor usage |
| 5 | Production-safe media storage before real beta traffic |
| 6 | Clear third-party AI processing/consent behavior |
| 7 | Deletion/GC **or** an explicitly documented and reliable beta wipe procedure |
| 8 | Monitoring and backup/recovery appropriate to the beta environment |

**Maps:** YF-B02/B30 mitigated; does **not** alone clear B-STOR-01, B-ABU-03, YF-B01, B-PRIV-01, B-BAK-01.

---

## Remaining Wave 0 — CoS locks (minimize Brett escalation)

Brett directed: proceed on remaining Wave 0; minimize escalation. CoS locks below from W0-1 requirements + RT/Arch evidence. Escalate only if legal copy or irreversible policy wording is needed.

| ID | Decision | Status | Notes |
|----|----------|--------|-------|
| **W0-2** | Live vendor keys only after durable fail-closed spend caps **and** all paid/vendor paths entitlement-gated | **LOCKED** | Implied by beta-path #3–#4 |
| **W0-3** | Consent UX required before real beta traffic for third-party AI processing; Constitution “never train by default” must be honest in copy + vendor checklist | **LOCKED (requirement)** | Exact legal text → legal/ops checklist, not a new principle. Block server enqueue until accepted once shipped. |
| **W0-4** | Before invites: **either** M8.8-lite account/project delete+GC **or** documented reliable beta wipe/ops SLA | **LOCKED (either-or)** | CoS preference: ship documented wipe procedure as Wave 1 minimum; M8.8-lite if Architect says schedule-fit. Do not block Wave 1 start. |
| **W0-5** | Moderation: **accept** invite-only risk for known invitees + ToS; full CSAM/NSFW gate **not** required before first invites | **LOCKED** | RT YF-B07 condition. Revisit if invite circle expands beyond known users. |
| **W0-6** | Authorize **Wave 1 Beta.must** engineering against checklist below | **AUTHORIZED** | 2026-09-10 CoS under Brett W0-1 + proceed directive |

### Soft Track 2 knobs (still deferred — not Wave 1 blockers)
Premium density, own-footage-only default, SIMPLE_MOTION shape, customer-visible cost honesty — hold until SG.* auth.

---

## Wave 1 Beta.must checklist (AUTHORIZED)

Order (CoS):

1. **Invite gate** — disable public sign-up; invite code and/or allowlist (W0-1)
2. **Durable spend caps** — fail-closed when backend≠mock; not process-local-only (B-ABU-03 / YF-B05)
3. **Entitlement-gate all paid/vendor-backed paths** — not only AI_DIRECT compose (YF-B01 / B-QUO-04)
4. **StoragePort** production object storage (S3/R2 or equiv) (B-STOR-01)
5. **Email** — real VerificationEmailPort **or** pre-verified invites only (YF-B03)
6. **Consent** — third-party AI processing notice + accept before vendor upload (W0-3 / YF-B04)
7. **Deletion** — wipe runbook SLA and/or M8.8-lite delete+GC (W0-4 / B-PRIV-01)
8. **Backup + monitoring** appropriate to beta (B-BAK-01 + spend/ops alerts)
9. Gateway webhook secret fail-closed if exposed; share mint rate limits as should-fix

**Constraints:** No M3–M8 creative lock semantics changes unless Architect proves boundary gap. No permanent provider selection. No paid generation expansion / bake-off until caps+gates live. Creative Director undisturbed. Docs-place of proposal package optional after Architect APPROVE of Wave 1 plan.

**Exit:** Red Team re-check tip after Wave 1 PRs before first human invite.

---

## Explicit non-decisions (do not invent)

- Exact invite UX copy / invite code format → Eng+Architect within W0-1
- Exact consent/ToS legal wording → legal review artifact (requirement locked; text not invented here)
- Public free-tier numeric benefits beyond Constitution §H → unchanged
