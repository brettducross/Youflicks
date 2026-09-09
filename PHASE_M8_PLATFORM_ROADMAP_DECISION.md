# Phase M8 Roadmap Decision Document — Platform / Commercial / Entitlements

**Status:** Approved architecture specification — **not implemented**  
**Milestone name:** M8 — Platform (account lifecycle, entitlements, metering, commercial access, advertising economics, ops, privacy)  
**Basis:** CoS → Architect POST-M7 AUTOMATION STAGE 1 AUTHORIZED by Brett (2026-09-09); binding **Product Constitution** `/workspace/youflicks-locks/PRODUCT_CONSTITUTION.md` (sha256 `a9921097cf60aa6d0245ad8d50bd866a4169910b19a56af42811029b40857917`); baseline `origin/main` `d8d521bca5c3944ca30cd17d5ee8154fc1e1c27d` (M7 CLOSED; tip `270b6a3` preserved); VERIFY-ONLY suite green at that SHA (280/280); prior locks PHASE_2F / M1–M7 **immutable**  
**This document:** Authoritative **architecture definition** for M8 and Stage 1 analysis covering Product Constitution deliverables **A–H**. M8 **implementation is CLOSED**. Do not treat this file as evidence that billing, ads integrations, or commercial schema exist in product code. **Architect APPROVED this lock (2026-09-09)** as architecture-within-Constitution. **Implementation remains CLOSED** until CoS obtains separate authorization after any Brett Product Owner decisions listed in §H and a per-sub-milestone Engineer gate.

**Filename (locked):** `PHASE_M8_PLATFORM_ROADMAP_DECISION.md`  
**Do not** overwrite or mutate prior `PHASE_*` lock files (PHASE_2F, M1–M7) or the Product Constitution to ease M8.

Authoritative Git repository: clean public `github.com/brettducross/Youflicks`.  
Treat `d8d521bca5c3944ca30cd17d5ee8154fc1e1c27d` as the authoritative implementation checkpoint for M8 design (M7 CLOSED).

Roadmap placement: **M8 = Platform / commercial / entitlements** after M7 Share / Export / Publication. Creative pipeline through Publication remains authoritative and unchanged in meaning.

Existing scaffolding at baseline (do not redefine as creative): Better Auth `User` / `Session` / `Account` / `Verification` (`emailVerified`); Phase 2D taste + **post-film** sponsorship (`UserSponsorshipPreference`, `Sponsor*`, `SponsorPlacement`, `FilmCredits`) — **never** creative inputs. **No** Subscription / CreditLedger / UsageEvent / Entitlement tables yet.

---

## 0. Locked decisions

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | CreativePlan → StoryStructure → Timeline → GeneratedAsset → RenderJob → Playback → FinishedMovie → Publication binding **unchanged**. M8 does **not** redefine any creative artifact, job type, or port from PHASE_2F–M7. Do **not** mutate those locks. |
| D2 | M8 identity | **Platform.** First-class YouFlicks-owned concerns: account lifecycle, valid-email, entitlements, quotas, rate limits, abuse prevention, usage metering, AI/video **engine cost attribution**, subscription + prepaid commercial access, advertiser/sponsor **commercial** concepts, free-tier policy, watermark/ads **presentation policy**, ops/admin, observability, privacy/data lifecycle. Distinct from storytelling, cutting, rendering, watching, keeping, sharing. |
| D3 | Critical separation | **Billing ≠ creative intelligence. Advertising ≠ creative intelligence. Entitlements ≠ storytelling. Engine economics ≠ creative decisions. Sponsorship ≠ CreativePlan.** Free-tier allowance = **entitlement / usage / rate rules** — **NEVER** special cases inside CreativePlan / StoryStructure / Timeline / GeneratedAsset / RenderJob **meaning**. |
| D4 | Provider neutrality | Permanent. Payment processors, ad networks, email providers, analytics vendors = **adapters** behind ports. Open string keys for provenance — **never** Prisma vendor enums for Stripe/AdSense/etc. |
| D5 | Enforcement locus | Entitlement and commercial policy are enforced at **gates** around the pipeline (enqueue, duration cap check, presentation/watermark flag, ads shell, export policy) — **not** inside AiDirectorPort / StoryComposerPort / TimelineComposerPort / AssetGeneratorPort / RendererPort creative contracts. |
| D6 | Free tier (Constitution §5A) | Valid email required. **1** free movie generation / hour. **Max 5-minute** finished movie. **Watermarked** output. **Advertising enabled**. Free movie must be a **genuine usable YouFlicks movie** (full CreativePlan→Share quality path), not a crippled demo. Exact enforcement = EntitlementSnapshot + gates (see §D / §4). |
| D7 | Commercial models (Constitution §5) | Three complementary access models: **(A)** Free ad-supported · **(B)** Subscription (primary commercial) · **(C)** Prepaid credits / pay-to-play. Exact plan SKUs, prices, credit packs, ad CPMs = **Brett Product Owner** (§H) — architecture holds ports + ledgers without inventing prices. |
| D8 | Watermark & ads | Watermark and ads are **presentation / commercial policy** driven by entitlement flags (`watermarkRequired`, `adsEnabled`). Watermark may be applied at render presentation or export post-process via a **policy adapter**, not as a Director creative beat. Ads/sponsor surfaces = UI shell / post-film / Phase 2D placement paths — **forbidden** to inject into CreativePlan/Story/Timeline or into the movie as creative content unless a **future** PO feature explicitly authorizes in-movie ads (out of M8 v1 scope). |
| D9 | Ports / services (soft names) | **`EntitlementPort`** / **`EntitlementService`** — resolve effective entitlements for a user. **`UsageMeterPort`** / **`UsageMeterService`** — record and query usage + engine cost attribution. **`BillingPort`** — subscription + prepaid adapters (charge, credit, webhook). **`AdvertisingPort`** — commercial campaign/serve surfaces (not creative). **`AccountLifecycleService`** — wraps Better Auth email verification / account states. Optional soft: **`RateLimitPort`**, **`AbuseSignalPort`**, **`AdminOpsPort`**, **`PrivacyLifecyclePort`**. Do **not** overload Director/Story/Timeline/Asset/Render/Playback/Movie/Publication services with billing ownership of meaning. |
| D10 | Job types | Prefer **sync gates** + existing creative jobs. New platform jobs only if needed (e.g. `BILLING_WEBHOOK`, `USAGE_ROLLUP`, `PRIVACY_EXPORT`) — open strings. **Ban** `AI_BILL`, `AI_ADS`, `AI_ENTITLEMENT` and any job that implies billing/ads are creative AI. |
| D11 | Schema posture | New YouFlicks-owned tables as needed: e.g. `EntitlementGrant`, `UsageEvent`, `CreditLedger` / `CreditBalance`, `Subscription`, `Invoice`/`PaymentEvent` (thin), `EngineCostEvent`, harden admin/privacy artifacts. Open string status keys. **Do not** put plan prices or ad CPMs into CreativePlan JSON. Phase 2D Sponsor* remains **post-film / preference** scaffolding — M8 may **harden commercial meaning** of ads without making SponsorPlacement a creative input. |
| D12 | Stage boundary | This lock = **architecture definition only**. **No** M8 implementation, payment SDK wiring, ad network integration, billing schema migration in product, or commercial code until **separate** CoS/Brett authorization per sub-milestone. Quiet beta instrumentation may be designed here; shipped only under later auth. |

---

## 1. Objective (Deliverable A — purpose + non-goals)

### Purpose
Give YouFlicks a **platform layer** so families can create genuine movies under a **fair free tier**, upgrade via **subscription** or **prepaid credits**, subsidize engine cost with **advertising** where allowed, meter **AI/video engine economics**, prevent abuse, operate the product, and respect **privacy** — **without** letting money, ads, or quotas own creative intelligence.

Pipeline (unchanged meaning):

**CreativePlan → Story → Timeline → GeneratedAsset → Render → Playback → FinishedMovie → Publication → (M8) Platform gates & commercial surfaces**

Architectural rule: **Platform surrounds the pipeline; it does not become the pipeline.**

### Explicit non-goals (M8 architecture / v1 platform scope)
- Changing PHASE_2F–M7 creative contracts, ports, or job semantics
- Making CreativePlan / Story / Timeline / GeneratedAsset / Render **aware** of “free vs paid” as narrative meaning
- NLE, social network, permanent public CDN of library bytes
- Single-vendor payment or ad lock-in as domain truth
- Implementing Stripe/AdSense/etc in this Stage 1 document (adapters later)
- Exact consumer prices, plan catalogs, credit pack SKUs, advertiser contracts (Brett — §H)
- Family multi-seat accounts as full product (design note OK; ship later)
- In-movie forced ad injection into the cut (forbidden unless future PO feature)
- Training on customer footage by default (Constitution — privacy)
- Opening “M9+” creative milestones disguised as platform work
- Salvaging obsolete Cursor 2G–2I work

---

## 2. M8 architecture (Deliverable B)

### 2.1 Layering

```
┌─────────────────────────────────────────────────────────────┐
│  Product UX (Start a Movie, review, library, share, account) │
├─────────────────────────────────────────────────────────────┤
│  Platform services (M8)                                      │
│  AccountLifecycle · Entitlement · UsageMeter · Billing       │
│  Advertising (commercial) · RateLimit/Abuse · Admin · Privacy│
├─────────────────────────────────────────────────────────────┤
│  Creative pipeline services (PHASE_2F–M7) — UNCHANGED meaning│
│  Director → Story → Timeline → Asset → Render → Playback →   │
│  Movie → Publication                                         │
├─────────────────────────────────────────────────────────────┤
│  Ports / adapters (provider-neutral)                         │
│  Storage · JobQueue · AI* · Renderer · Playback · Publication│
│  + BillingPort · AdvertisingPort · EmailVerify · Meter sink  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Core domain objects (YouFlicks-owned)

| Object | Role |
| --- | --- |
| **EntitlementSnapshot** | Resolved, versioned view of what a user may do *now*: generation rate, max duration, watermarkRequired, adsEnabled, storage caps, priority flags, planKind (`FREE` \| `SUBSCRIPTION` \| `PREPAID` \| hybrid). Not a CreativePlan. |
| **UsageEvent** | Append-only meter: userId, projectId?, jobId?, capability/kind (`MOVIE_GENERATION`, `RENDER_SECONDS`, `ASSET_CALL`, …), quantity, recordedAt, optional engineCost attribution. |
| **EngineCostEvent** | Internal economics: providerKey (provenance), capability, estimated/actual cost units, linked UsageEvent/Job — **ops/finance**, never fed into Director as creative input. |
| **CreditLedger** | Prepaid balance mutations (grant, spend, expire, refund). |
| **Subscription** | Commercial subscription state (status, period, external ref via BillingPort) — open string planKey. |
| **AccountGate** | emailVerified + abuse flags + lifecycle state. |
| **CommercialSurface** | Ads/sponsor presentation opportunities (pre-roll UI, end card, library banner) — distinct from SponsorPlacement creative-input ban. |

### 2.3 Entitlement resolution (conceptual)

`EntitlementService.resolve(userId) → EntitlementSnapshot`

Order (illustrative, Engineer may refine without changing meaning):
1. Hard blocks (unverified email, suspended, abuse quarantine) → deny generation.
2. Active **Subscription** grants (if any).
3. **Prepaid** credit balance → spendable generation rights.
4. Else **Free** Constitution defaults (D6).
5. Merge quotas / rate windows / feature flags.

Hybrid allowed (e.g. subscriber + prepaid top-up) without creative branching.

### 2.4 Gate protocol (mandatory pattern)

Before starting a **movie generation** (Constitution: 1/hour free) — typically at first creative enqueue the product treats as “a generation” (soft default: **AI_DIRECT** start of a new movie attempt; Engineer + Architect may refine the meter boundary in M8.2/M8.3 without putting free-tier fields into CreativePlan):

```
authorizeGeneration(userId, intent: { requestedMaxDurationMs?, projectId? })
  → ALLOW { snapshot, remainingQuota, constraints }
  | DENY { code: EMAIL_UNVERIFIED | RATE_LIMITED | DURATION_EXCEEDS_PLAN | INSUFFICIENT_CREDITS | SUSPENDED | … }
```

- **ALLOW** may attach **constraints** (e.g. `maxOutputDurationMs: 300000`, `watermarkRequired: true`) consumed by **orchestrator / Render presentation / export policy** — **not** written into CreativePlan.plan as story meaning.
- If user brief asks for 12 minutes on free tier → **DENY or upgrade prompt** at the gate (or clamp with explicit user-visible honesty). **Do not** silently rewrite StoryDocument to a “free-tier plot.”

At **Render** / keep / export:
- Enforce `maxOutputDurationMs` against produced `durationMs` where applicable (fail typed if over).
- Apply `watermarkRequired` via **WatermarkPolicy** adapter on output bytes or player chrome — provenance `providerKey` optional; not Director.

At **Playback / Library / Share UI**:
- If `adsEnabled`, **AdvertisingPort** may serve commercial surfaces **outside** the movie essence (shell, pre/post). Phase 2D opt-in prefs remain; free-tier Constitution says advertising enabled — reconcile UX honesty with preference defaults in M8.4/M8.6 (Brett if conflict — §H).

### 2.5 BillingPort (soft)

```
BillingPort.createCheckout / reportUsage / applyCredit / handleWebhook → BillingResult
```

Adapters: Stripe, etc. Domain stores YouFlicks ids + open `providerKey` + external refs — never vendor enums.

### 2.6 AdvertisingPort (soft)

```
AdvertisingPort.eligibleSurfaces(user, context) → Surface[]
AdvertisingPort.recordImpression / recordClick (metering)
```

Must not call AiDirectorPort. Must not write CreativePlan. May read EntitlementSnapshot + UserSponsorshipPreference.

### 2.7 Observability & admin

- Structured logs/metrics on gates, UsageEvents, Billing webhooks, job failures — **PII minimization**.
- Admin: suspend user, inspect quotas, refund credit (audit trail), feature flags — **AdminOpsPort** / role-gated APIs.
- No admin “override CreativePlan meaning via billing.”

### 2.8 Privacy / data lifecycle

- User owns footage (Constitution).
- Private by default; never train on customer footage by default.
- **PrivacyLifecyclePort**: export / delete account & project data; retention policy hooks.
- Local processing aspiration remains future; M8 designs hooks, does not require local runtime for exit of early M8.x.

---

## 3. Critical boundary audit (Deliverable C)

| Boundary | Risk if violated | M8 proof requirement |
| --- | --- | --- |
| Billing ≠ creative intelligence | Plans steer story/style | No BillingPort calls from Director/Story/Timeline/Asset adapters; no planKey in CreativePlan JSON |
| Advertising ≠ creative intelligence | Sponsors write the movie | AdvertisingPort / SponsorPlacement never inputs to Director; placements post-film / UI shell only |
| Entitlements ≠ storytelling | Free users get different “narrative grammar” | EntitlementSnapshot constraints outside plan/story/timeline payloads |
| Engine economics ≠ creative decisions | Cheapest model chosen as plot device | EngineCostEvent is ops-only; provider selection remains capability/honesty (existing neutrality), not cost-minimizing creative rewrite |
| Sponsorship ≠ CreativePlan | Phase 2D adjacency becomes creative | Harden: Sponsor* cannot be required for AI_DIRECT; credits lines may show sponsors only when placement APPROVED post-film |
| Free allowance ≠ pipeline forks | Duplicate “FreeDirector” path | Single pipeline; gates only |

**Regression tests (architecture expectation for later impl):** attempt to pass `planKind` into CreativePlan validation → reject; Director unit tests unchanged by Billing mocks; Publication/Movie services do not require Subscription row to Keep/Share (Keep/Share remain M6/M7; **generation** may require entitlement).

---

## 4. Free-tier architecture (Deliverable D)

### 4.1 Rules (locked by Constitution — not renegotiated here)
1. Valid email (`User.emailVerified === true`) before free generation.
2. **1** movie generation per rolling **hour** (meter kind `MOVIE_GENERATION`).
3. Max finished movie **5 minutes** (`maxOutputDurationMs = 300_000`).
4. **Watermark** on output (`watermarkRequired = true`).
5. **Advertising enabled** (`adsEnabled = true`).
6. Output must be **genuine** YouFlicks movie (same PHASE_2F–M7 path).

### 4.2 Enforcement map

| Rule | Enforce at | Not at |
| --- | --- | --- |
| Valid email | AccountGate before authorizeGeneration | CreativePlan schema |
| 1/hour | UsageMeter + Entitlement rate window | StoryComposer “shorten because free” |
| Max 5 min | Gate constraints + render/export duration check | Silent StoryDocument truncation without user-visible policy |
| Watermark | WatermarkPolicy on render/export/player | Director scene “show logo as plot” |
| Ads enabled | AdvertisingPort surfaces + prefs honesty | Inject VIDEO_ADVERTISEMENT into TimelineClip as unpaid creative |

### 4.3 “Genuine usable movie”
Free tier uses the **same** CreativePlan→Share pipeline and quality bar. Degraded demos, slideshow-only forks, or “free narrative mode” are **forbidden**. Limits are **quantity/duration/presentation**, not intelligence amputation.

### 4.4 Honesty
Capability / entitlement honesty in account UX: remaining free generations, duration cap, watermark/ads expectations — mirror existing `canExport` / `canShareLink` style flags (e.g. `canGenerate`, `entitlementSummary`).

---

## 5. M8 milestone decomposition (Deliverable E)

Each sub-milestone is **independently reviewable**. Implementation of each requires its own CoS→Engineer auth after this parent lock. **No** silent bundling of payments + ads + creative changes.

### M8.1 — Account lifecycle & valid-email gate
- **Purpose:** Reliable identity; email verification required for free generation; session honesty.
- **Arch:** AccountLifecycleService on Better Auth; gate on `emailVerified`; Verification flows.
- **Deps:** Baseline auth at `d8d521b`.
- **Locks:** This doc D6/D9; Constitution §5A.
- **Scope:** Verify/resend email UX; block generation if unverified; no Stripe.
- **Tests:** Unverified cannot authorizeGeneration; verified can (subject to later quotas).
- **Gates:** Architect review of PR vs this section; §8 style suite green.
- **Risks:** Auth provider quirks; email deliverability (ops).
- **Brett vs autonomous:** Autonomous within Constitution; escalate legal copy of verification emails if needed.

### M8.2 — Entitlements, quotas, rate limits, abuse prevention
- **Purpose:** EntitlementSnapshot + authorizeGeneration; rate limits; abuse signals (burst, multi-account heuristics — start simple).
- **Arch:** EntitlementPort/Service; RateLimit; deny codes; no creative writes.
- **Deps:** M8.1.
- **Locks:** D3–D6, D9–D11.
- **Scope:** Free defaults; stub subscription/prepaid resolvers returning empty; abuse quarantine flag.
- **Tests:** 2nd generation within hour denied; duration over max denied; stranger cannot burn another user’s quota.
- **Gates:** Boundary tests in §3.
- **Risks:** Wrong meter boundary (“what counts as a generation?”) — Architect refine without creative forks.
- **Brett:** Only if meter definition changes product meaning of “1 movie / hour.”

### M8.3 — Usage metering & engine cost attribution
- **Purpose:** UsageEvent + EngineCostEvent; attribute AI/video spend for ops.
- **Arch:** UsageMeterPort; hooks from job success/failure; ProviderAttribution may correlate — cost tables remain separate from creative payloads.
- **Deps:** M8.2.
- **Scope:** Metering + internal cost; **no** customer invoices required yet.
- **Tests:** Events recorded for generation/render; cost never appears in CreativePlan JSON.
- **Brett:** Cost visibility to end users (show “credits used”) = PO if customer-facing.

### M8.4 — Free-tier policy binding (watermark + ads flags)
- **Purpose:** Wire D6 constraints end-to-end: watermark policy adapter; adsEnabled surfaces; UX honesty.
- **Arch:** WatermarkPolicy; AdvertisingPort stub/serve; entitlement flags on playback/library chrome.
- **Deps:** M8.2; M5/M6/M7 for apply points.
- **Scope:** Free path complete without paid adapters; genuine pipeline.
- **Tests:** Free output watermarked; ads surfaces only when adsEnabled; creative fixtures unchanged.
- **Brett:** Watermark visual design; whether free `allowVideoAds` preference defaults override Constitution (escalate if prefs conflict).

### M8.5 — Subscription + prepaid (BillingPort)
- **Purpose:** Commercial access models B+C; checkout; webhooks; credit ledger; subscription grants into EntitlementService.
- **Arch:** BillingPort adapters; Subscription + CreditLedger schema; webhooks idempotent.
- **Deps:** M8.2–M8.3.
- **Scope:** Architecture allows; **implementation auth separate**; no creative changes.
- **Tests:** Credit spend/refund; subscription active upgrades caps; webhook replay safe.
- **Brett (required before ship):** Plan SKUs, prices, credit packs, refund policy (§H).

### M8.6 — Advertising / advertiser economics
- **Purpose:** Ad-supported free economics; harden Phase 2D commercial path; AdvertisingPort; impression metering; **still** no creative control.
- **Arch:** Separate advertiser concepts; campaigns/offers remain non-inputs to Director; optional linkage to FilmCredits **post-film** only.
- **Deps:** M8.4; Phase 2D scaffolding.
- **Scope:** Commercial surfaces + measurement; **no** ad-network production requirement until Brett picks vendor.
- **Tests:** Ads path cannot write CreativePlan; declining placement does not block Keep/Share.
- **Brett:** Ad network, revenue share, sponsor contracts, in-movie ads (default **no**).

### M8.7 — Ops / admin / observability
- **Purpose:** Operate beta: admin suspend, quota inspect, feature flags, dashboards, alerting on gate/job failures.
- **Deps:** M8.2–M8.3.
- **Scope:** Admin role model; metrics; audit log. No silent data destruction.
- **Brett:** Who may be admin; retention of admin audit.

### M8.8 — Privacy & data lifecycle
- **Purpose:** Export/delete; retention; “never train by default” technical hooks.
- **Arch:** PrivacyLifecyclePort; delete cascades reviewed vs MediaAsset sacredness (delete = user-requested).
- **Deps:** M8.1+.
- **Brett / legal:** Retention periods, deletion SLAs, training policy copy (§H).

---

## 6. Productization track map (Deliverable F) — design only, do not implement here

| Productization item | Belongs | Notes |
| --- | --- | --- |
| Onboarding | **M8.1** + early UX polish | Email verify; first-run “Start a Movie” |
| Start a Movie | **UX productization** on existing Project + Phase 2F entry | Not a new creative milestone; may gate via M8.2 |
| Brief UX | Phase 2F / ProjectCreativeIntent polish | Not M8 commercial core |
| Review (story/cut/assets) | M1–M3 UX polish | Recomposition later — creative, not billing |
| NL revision | **Future creative** (recompose under locks) | Not M8; do not fold into billing |
| Library / family UX | M6 library + **future family accounts** | Family seats = later PO; M8 notes multi-seat entitlement extension point only |
| Progress / errors | Cross-cutting UX on Job status | Platform observability (M8.7) assists |
| Responsive web | Client polish | Parallel track; not billing |
| Beta instrumentation | **M8.7** (+ privacy-safe analytics adapter) | Quiet 20–100 beta (Constitution §15) |

Productization may ship in parallel **without** waiting for M8.5–M8.6 **if** free-tier M8.1–M8.4 gates exist for abuse control — CoS sequencing call.

---

## 7. Commercial economics architecture (Deliverable G)

Three rails, one pipeline:

| Rail | Who pays | Entitlement effect | Creative effect |
| --- | --- | --- | --- |
| **Free + ads** | Attention / ads | Low rate, 5-min cap, watermark, adsEnabled | **None** (same pipeline) |
| **Subscription** | Recurring | Higher caps, optional watermark/ads off, storage/priority | **None** |
| **Prepaid** | Credits | Spend credits for generations / minutes | **None** |
| **Advertiser revenue** | Brands | Subsidizes free rail; funds engine | **None** — commercial surfaces only |

Engine cost attribution (M8.3) informs **ops pricing** and future Brett plan design — it must **not** auto-downgrade narrative quality mid-movie.

Watermark removal / ads removal = **entitlement flags** from paid rails, not a second renderer product.

---

## 8. Product Owner decisions only (Deliverable H) — minimize

Architecture **APPROVE** does **not** invent these. Brett must decide before the named sub-milestone **ships** (not before architecture lock):

1. **Subscription plan catalog** — names, monthly/annual prices, included generations/minutes, watermark/ads policy per plan (blocks **M8.5 ship**).
2. **Prepaid credit packs** — sizes, prices, expiry, what one credit buys (blocks **M8.5 ship**).
3. **Meter boundary confirmation** — does “1 free movie generation / hour” mean one AI_DIRECT, one full Render, or one Keep? Architect default: **one authorized movie-generation attempt** starting at Director enqueue; Brett confirm if different (blocks **M8.2 ship** if disputed).
4. **Watermark design** — visual/branding (blocks **M8.4 polish**, not gate logic).
5. **Free-tier vs sponsorship prefs** — Constitution enables ads on free; Phase 2D defaults many sponsor prefs **off**. Brett: free tier may **require** ads as condition of free access vs honor hard opt-out (blocks **M8.4/M8.6** policy).
6. **Ad network / primary advertiser path** (blocks **M8.6 production**).
7. **Refund / chargeback / tax** posture (blocks **M8.5 production**).
8. **Privacy retention & deletion SLA**; training policy customer copy (blocks **M8.8 ship**).
9. **Admin who** (blocks **M8.7** production access).
10. **Family accounts** — defer; not required for M8.1–M8.4.

**Not escalated (autonomous within Constitution):** port shapes, table shapes, deny codes, adapter boundaries, test strategy, sequencing M8.1→M8.4 before paid rails, refusal to put billing into CreativePlan.

---

## 9. Automation boundary analysis

| Stage | Allowed | Forbidden |
| --- | --- | --- |
| **Stage 1 (now)** | Constitution + this M8 architecture lock; CoS docs-place; Architect APPROVE | M8 code, payment/ad SDKs, commercial schema in product, Engineer M8 impl, mutating PHASE_2F–M7 |
| **After Brett §H answers needed for a slice** | CoS may authorize **that** M8.x only | Jumping to M8.5/M8.6 without prices/vendor where required |
| **Always escalate** | New principles, lock edits, vision/security/privacy/legal, commercial beyond Constitution, destructive data, unresolved Architect↔Engineer disagreement | — |

Charter note: prior autonomous charter **stopped at M7 CLOSED**. M8 work proceeds only under **Brett’s Stage 1 auth** (architecture) and **future per-slice auth** (implementation).

---

## 10. Recommended next checkpoint

1. CoS **docs-place** Product Constitution + this lock onto `origin/main` (docs-only PR) — **do not** open M8 implementation PR.
2. Brett answers **§H items 3 and 5** early (meter boundary + free ads vs prefs) so M8.1–M8.4 can be authorized cleanly.
3. Next implementation authorization candidate: **M8.1 → M8.2 → M8.3 → M8.4** (free platform) before paid/ad production.
4. Architect reviews each M8.x PR against this parent lock + §3 boundary tests.
5. **STOP** creative M9; **STOP** silent PHASE lock edits.

---

## 11. Must include (architecture exit for this document)

1. D1–D12 locked decisions above.  
2. Deliverables A–H covered.  
3. Explicit free-tier enforcement map (§4).  
4. Independently reviewable M8.1–M8.8 decomposition (§5).  
5. Proof plan that commercial rails cannot own creative meaning (§3).  
6. Clear Stage 1 vs implementation boundary (§9).  

## 12. Must not include

- Code, migrations, payment/ad integrations in this Stage  
- Mutation of PHASE_2F–M7 or Constitution  
- CreativePlan free-tier narrative forks  
- In-movie ad injection as default  
- Invented consumer prices  
- NLE / social network / public CDN  
- `AI_BILL` / `AI_ADS` job types  

---

## 13. Self-review (Architect)

| Check | Result |
| --- | --- |
| Constitution alignment (§4–6, §17–20) | PASS |
| PHASE_2F–M7 immutability | PASS (D1) |
| Billing/ads/entitlements ≠ creative | PASS (D3, §3) |
| Free tier genuine movie | PASS (§4.3) |
| Provider neutrality | PASS (D4) |
| Hard-stop: new principle? | No — extends Constitution |
| Hard-stop: lock conflict? | No |
| Hard-stop: vision change? | No |
| Hard-stop: security/privacy judgment needing Brett now? | Deferred to §H.8 for **ship**, not for architecture |
| Hard-stop: legal/commercial beyond Constitution? | Prices/vendors in §H — architecture stays inside Constitution rails |
| Unresolved disagreement | None |

### Verdict
**APPROVE** — `PHASE_M8_PLATFORM_ROADMAP_DECISION.md` as Stage 1 M8 Platform architecture lock.

**Escalations to Brett:** none that block architecture APPROVE. **Ship blockers** listed in §H (minimize). CoS may docs-place; **implementation CLOSED** until separate auth.

**Explicit:** no code; no Engineer; no payment/ad integrations; no M8 schema in product from this document alone.

---

## 14. Document control

- **Author:** YouFlicks Architect  
- **Date:** 2026-09-09  
- **Baseline:** `d8d521bca5c3944ca30cd17d5ee8154fc1e1c27d`  
- **Constitution sha256:** `a9921097cf60aa6d0245ad8d50bd866a4169910b19a56af42811029b40857917`  
- **This file sha256:** see sidecar PHASE_M8_PLATFORM_ROADMAP_DECISION.md.sha256 (authoritative)
