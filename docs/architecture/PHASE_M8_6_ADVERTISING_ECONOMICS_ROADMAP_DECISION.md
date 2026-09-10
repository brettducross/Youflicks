# Phase M8.6 Roadmap Decision Document — Advertising / Advertiser Economics

**Status:** Approved architecture specification — **amended 2026-09-10** (Brett PO commercial lock) — implementation authorized **within this lock**; first-party before external network; **no invented CPMs**  
**Milestone name:** M8.6 — AdvertisingPort production + advertiser/sponsor revenue economics  
**Basis:** Original Architect APPROVE 2026-09-09; **AMENDMENT** after Brett PO commercial decisions LOCKED 2026-09-10; Constitution + parent PHASE_M8; M8.4 stub + §H5 free-rail shipped  
**This document:** Authoritative architecture for M8.6. Engineer may harden first-party surfaces and measurement **without** external ad-network SDK until PO picks a vendor. IN-MOVIE remains **forbidden**.

**Filename (locked):** `PHASE_M8_6_ADVERTISING_ECONOMICS_ROADMAP_DECISION.md`  
**Do not** mutate PHASE_2F–M7, Constitution, or parent PHASE_M8.

---

## 0. Locked decisions

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | Creative pipeline + M8.1–M8.4 unchanged. v1 surfaces: **UI_SHELL** · **POST_FILM** · **LIBRARY_BANNER** (+ approved FilmCredits). |
| D2 | M8.6 identity | Harden AdvertisingPort + Phase 2D Sponsor* as **commercial** concepts. Advertiser revenue may subsidize free/engine economics — **never** creative control. |
| D3 | Critical separation | Advertising ≠ creative. Sponsorship ≠ CreativePlan. **IN_MOVIE = NO** (Brett locked). Never block Keep/Share; never drop movie quality on fill miss. |
| D4 | Provider neutrality | Ad networks = optional adapters. Open `providerKey`. No hard-wired network in domain. |
| D5 | Ads by tier (Brett) | **FREE:** ads on UI/chrome + post-film + library (§H5; prefs cannot hard opt-out). **PLUS / FAMILY:** ads **off by default** via Entitlement grants (M8.5). |
| D6 | Surfaces | Same three M8.4 surfaces; FilmCredits when APPROVED post-film. Impression/click → ops events. |
| D7 | Sponsor path (**AMENDED**) | **First-party sponsors preferred before external network.** Allowed: UI shell/logo, post-film, library, approved FilmCredits. Never in cut / creative control. |
| D8 | Ad-funded credits (**AMENDED**) | **YES eventually**, ledger `AD_SUBSIDY`, **capped** (cap TBD). Ads never unlock unlimited expensive consumption. Entitlement only. |
| D9 | Measurement | recordImpression / recordClick; fraud later (M8.7). |
| D10 | Stage boundary | First-party harden + measurement **authorized**. External network adapter needs PO vendor. No invented CPMs. |
| D11 | Deps | M8.4 AdvertisingService stub; M8.5 ledger for AD_SUBSIDY bridge; M8.3 optional for ops. |
| D12 | Ban | `AI_ADS`; Timeline VIDEO_AD creative; Director reading SponsorOffer; Keep/Share gated on ads. |

---

## 1. Objective

Production-capable, provider-neutral advertising/sponsor economics funding the free rail — without owning storytelling.

Architectural rule: **Ads pay for access chrome. Ads do not cast the film.**

---

## 2. Ports / services (soft)

```
AdvertisingPort
  eligibleSurfaces(user, context) → Surface[]
  recordImpression / recordClick
  fetchCreative(surface) via adapter

Adapters (order): Stub (shipped) → FirstPartySponsorAdapter (preferred next) → ExternalNetworkAdapter (later, PO vendor)
AdvertisingService — adsEnabled from EntitlementSnapshot; §H5 on FREE; never AiDirectorPort
```

---

## 3. Economics rails

| Rail | Funding | Entitlement | Creative |
| --- | --- | --- | --- |
| FREE + ads | Attention / first-party (then network) | M8.4 free snapshot | None |
| PLUS / FAMILY | Subscription (M8.5) | ads off by default | None |
| Prepaid | Credits (M8.5) | usage-abstracted spend | None |
| Advertiser | Brands | optional capped AD_SUBSIDY | Surfaces only |

---

## 4. Boundary audit

| Risk | Proof |
| --- | --- |
| In-movie injection | IN_MOVIE empty + tests |
| Sponsor → DirectorInput | forbid |
| Fill miss hurts quality | empty surface; movie plays |
| Unlimited AD_SUBSIDY | hard cap field (TBD value) |

---

## 5. Must include / must not

**Include:** D1–D12; first-party preference; FREE vs PLUS/FAMILY ads; capped AD_SUBSIDY posture; IN_MOVIE ban.  
**Must not:** Invent CPMs; ship external SDK without PO vendor; in-movie ads; creative lock mutation.

---

## 6. Impl decomposition

| Slice | Purpose | Blocks on Brett? |
| --- | --- | --- |
| **M8.6a** | Impression/click persistence + ops queries | **No** |
| **M8.6b** | First-party Sponsor serve on allowed surfaces | **No** (contracts escalate if legal copy needed) |
| **M8.6c** | External network adapter | **Yes** — vendor |
| **M8.6d** | AD_SUBSIDY → CreditLedger (capped stub) | Cap value TBD; stub structure **No** |

---

## 7. Product Owner decisions

### Still open
1. External network **vendor** (if/when beyond first-party).  
2. Sponsor **contracts / revenue share** (legal).  
3. **AD_SUBSIDY numeric cap**.  

### Locked 2026-09-10
First-party preferred; surfaces; IN_MOVIE NO; FREE ads on; PLUS/FAMILY ads off by default; AD_SUBSIDY yes capped eventually; commercial≠creative.

---

## 8. Self-review / Verdict

| Check | Result |
| --- | --- |
| Brett 2026-09-10 | PASS |
| First-party before network | PASS (D7) |
| IN_MOVIE NO | PASS |
| Invented CPMs? | No |

### Verdict
**AMEND → APPROVE** — amended `PHASE_M8_6_ADVERTISING_ECONOMICS_ROADMAP_DECISION.md`.

---

## 9. Document control

- **Author:** YouFlicks Architect  
- **Dates:** 2026-09-09 APPROVE; **2026-09-10 AMEND** (Brett PO)  
- **This file sha256:** see sidecar `PHASE_M8_6_ADVERTISING_ECONOMICS_ROADMAP_DECISION.md.sha256`
