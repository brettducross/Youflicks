# Phase M8.6 Roadmap Decision Document — Advertising / Advertiser Economics

**Status:** Approved architecture specification — **not implemented**  
**Milestone name:** M8.6 — AdvertisingPort production path + advertiser/sponsor revenue economics  
**Basis:** CoS → Architect M8.5+M8.6 ARCHITECTURE/DESIGN ONLY AUTHORIZED by Brett (2026-09-09); Product Constitution (sha256 `a9921097cf60aa6d0245ad8d50bd866a4169910b19a56af42811029b40857917`); parent PHASE_M8 (sha256 `a7c5b54aaf733918b6324ba0a16bfbe17427fe1bb4cd17f883729973984f4ccd`); baseline `79ee97ee9ec39bc7354f672528642ebd1fa88463` (M8.4 CLOSED — AdvertisingPort stub + §H5 free-rail already shipped)  
**This document:** Authoritative architecture for **future** M8.6 production advertising / advertiser economics. **No** ad-network SDKs, advertiser contracts, or CPM prices in code from this Stage. **Architect APPROVED (2026-09-09).** Implementation CLOSED until CoS + Brett §H for production vendor/contracts.

**Filename (locked):** `PHASE_M8_6_ADVERTISING_ECONOMICS_ROADMAP_DECISION.md`  
**Do not** mutate PHASE_2F–M7, Constitution, or parent PHASE_M8.

---

## 0. Locked decisions

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | Creative pipeline + M8.1–M8.4 unchanged in meaning. M8.4 stub surfaces (UI_SHELL / POST_FILM / LIBRARY_BANNER) remain the only v1 commercial surfaces. |
| D2 | M8.6 identity | Harden **AdvertisingPort** for production measurement + optional external ad-network adapters; harden Phase 2D Sponsor* as **commercial** concepts; advertiser revenue subsidizes free/engine economics — **never** creative control. |
| D3 | Critical separation | Advertising ≠ creative intelligence. Sponsorship ≠ CreativePlan. Engine economics ≠ creative decisions. No IN_MOVIE injection unless a **future** PO feature explicitly authorizes (default **forbidden**). |
| D4 | Provider neutrality | Ad networks / mediation = adapters. Open `providerKey`. Never Prisma vendor enums. |
| D5 | §H5 preserved | Free-tier `adsEnabled: true`; prefs cannot hard opt-out of required free-rail ads. Paid rails may set `adsEnabled: false` via Entitlement grants (M8.5). |
| D6 | Surfaces | v1 production = same three surfaces as M8.4 stub. Impression/click → ops events (may correlate UsageEvent / new `AdImpressionEvent` — open string kinds). |
| D7 | Phase 2D | Sponsor / Campaign / Offer / Placement remain **post-film / preference** scaffolding. Placements never required for AI_DIRECT. FilmCredits may show sponsors only when APPROVED post-film. |
| D8 | Ad-funded credits | Optional bridge to M8.5: Advertising economics may **grant** promotional credits (ledger source `AD_SUBSIDY`) — entitlement only. |
| D9 | Measurement | recordImpression / recordClick; fraud basics later (M8.7). No creative rewrite on fill rate. |
| D10 | Stage boundary | Architecture only. No AdSense/IMA/etc SDK until Brett picks vendor + impl auth. |
| D11 | Deps | M8.4 AdvertisingService stub + EntitlementSnapshot.adsEnabled; M8.3 optional for cost vs ad revenue ops dashboards. |
| D12 | Ban | `AI_ADS`; TimelineClip VIDEO_AD as unpaid creative; Director reading SponsorOffer. |

---

## 1. Objective

Turn M8.4’s **stub** advertising surfaces into a **production-capable**, provider-neutral advertising/sponsor economics layer that funds the free rail and engine usage — without ever owning storytelling.

Architectural rule: **Ads pay for access chrome. Ads do not cast the film.**

---

## 2. Ports / services (soft)

```
AdvertisingPort  (exists as stub)
  eligibleSurfaces(user, context) → Surface[]
  recordImpression / recordClick
  // M8.6 adds: fetchCreative(surface) via adapter; reportRevenue(ops)

AdvertisingService — EntitlementSnapshot.adsEnabled gate; §H5; never calls AiDirectorPort
SponsorAdminService (optional) — Phase 2D campaign CRUD for ops — not Director input
```

Adapters: `StubAdvertisingAdapter` (shipped M8.4) → `ExternalNetworkAdapter` / `FirstPartySponsorAdapter` later.

---

## 3. Economics rails (with M8.5)

| Rail | Funding | Entitlement | Creative |
| --- | --- | --- | --- |
| Free + ads | Attention / ad fill | M8.4 free snapshot | None |
| Subscription | User payment (M8.5) | Raised caps; ads may off | None |
| Prepaid | Credits (M8.5) | Spend for gens | None |
| Advertiser | Brands (M8.6) | May fund AD_SUBSIDY credits / free rail | Surfaces only |

EngineCostEvent (M8.3) vs AdImpression revenue = **ops dashboard** concern — never auto-shortens StoryDocument.

---

## 4. Boundary audit

| Risk | Proof |
| --- | --- |
| Ad creative injected into Timeline | IN_MOVIE forbidden; tests |
| SponsorOffer → DirectorInput | forbid; Director privacy tests |
| adsEnabled written into CreativePlan | reject-list (M8.2/M8.4) |
| Fill failure degrades narrative quality | adapters return empty surface — movie still plays |

---

## 5. Must include / must not

**Include:** D1–D12; production adapter posture; Phase 2D commercial harden plan; impression metering; §H5; bridge to optional AD_SUBSIDY credits; minimized PO list.  
**Must not:** Invent CPMs/contracts; ship ad SDK; in-movie ads; mutate creative locks; require sponsor for Keep/Share.

---

## 6. Impl decomposition (future)

| Slice | Purpose | Blocks on Brett? |
| --- | --- | --- |
| M8.6a | Impression/click persistence + ops queries on stub | No (measurement only) |
| M8.6b | First-party Sponsor placement serve on POST_FILM | Soft — creative assets OK autonomous; contracts escalate |
| M8.6c | External ad-network adapter | **Yes** — vendor |
| M8.6d | AD_SUBSIDY → CreditLedger bridge | Needs M8.5 ledger + PO rules |

---

## 7. Minimized Product Owner decisions (block M8.6 **production**)

1. **Primary ad path** — first-party sponsors only vs external network vs both; which vendor if external.  
2. **Advertiser / sponsor contracts & revenue share** (legal/commercial).  
3. **In-movie ads** — default **NO** (locked); only escalate if Brett overturns.  
4. **AD_SUBSIDY rules** (if any) — when ads grant credits; caps (needs M8.5).

**Already decided:** §H5 free ads required; M8.4 surfaces; no creative control; Constitution §6.

**Autonomous:** AdvertisingPort adapter shape, impression schema, stub→real swap, IN_MOVIE ban enforcement, Phase 2D isolation tests, ops dashboards (with M8.7).

---

## 8. Self-review / Verdict

| Check | Result |
| --- | --- |
| Constitution §6 + §H5 | PASS |
| Parent PHASE_M8 M8.6 + M8.4 stub continuity | PASS |
| In-movie default forbidden | PASS |
| Invented CPMs? | No |

### Verdict
**APPROVE** — `PHASE_M8_6_ADVERTISING_ECONOMICS_ROADMAP_DECISION.md` as architecture lock. Implementation CLOSED.

---

## 9. Document control

- **Author:** YouFlicks Architect  
- **Date:** 2026-09-09  
- **Baseline:** `79ee97ee9ec39bc7354f672528642ebd1fa88463`  
- **This file sha256:** see sidecar `PHASE_M8_6_ADVERTISING_ECONOMICS_ROADMAP_DECISION.md.sha256`
