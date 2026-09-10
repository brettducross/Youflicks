# Phase M8.5 Roadmap Decision Document — Billing / Subscription / Prepaid Credits

**Status:** Approved architecture specification — **not implemented**  
**Milestone name:** M8.5 — BillingPort (Subscription + Prepaid pay-to-play)  
**Basis:** CoS → Architect M8.5+M8.6 ARCHITECTURE/DESIGN ONLY AUTHORIZED by Brett (2026-09-09); binding Product Constitution (sha256 `a9921097cf60aa6d0245ad8d50bd866a4169910b19a56af42811029b40857917`); parent `PHASE_M8_PLATFORM_ROADMAP_DECISION.md` (sha256 `a7c5b54aaf733918b6324ba0a16bfbe17427fe1bb4cd17f883729973984f4ccd`); baseline `origin/main` `79ee97ee9ec39bc7354f672528642ebd1fa88463` (M8.4 CLOSED; free-platform M8.1–M8.4 complete)  
**This document:** Authoritative architecture for **future** M8.5 implementation. **No** payment SDK wiring, plan SKUs/prices, credit pricing, refunds, or commercial schema in product from this Stage. **Architect APPROVED (2026-09-09).** Implementation CLOSED until CoS obtains Brett §H answers that block ship + separate Engineer auth.

**Filename (locked):** `PHASE_M8_5_BILLING_ROADMAP_DECISION.md`  
**Do not** mutate PHASE_2F–M7, Product Constitution, or parent PHASE_M8 to ease billing.

Authoritative repo: `github.com/brettducross/Youflicks`. Checkpoint `79ee97ee9ec39bc7354f672528642ebd1fa88463`.

---

## 0. Locked decisions

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | CreativePlan→…→Publication + M8.1–M8.4 platform gates unchanged in meaning. Billing never writes creative payloads. |
| D2 | M8.5 identity | **BillingPort** + YouFlicks-owned commercial records: Subscription, CreditLedger/CreditBalance, PaymentEvent (thin webhook audit). Access models **B (Subscription)** and **C (Prepaid)** from Constitution §5. |
| D3 | Critical separation | Billing ≠ creative intelligence. PlanKind / prices / credit balances never enter CreativePlan, StoryStructure, Timeline, GeneratedAsset, RenderJob meaning. EntitlementService remains the only path from paid grants → generation gates. |
| D4 | Provider neutrality | Payment processors = adapters behind **BillingPort**. Open `providerKey` strings. **Never** Prisma enums for Stripe/Paddle/etc. |
| D5 | Grant injection | `SubscriptionResolver` / `PrepaidResolver` (today Empty*) become real readers of YouFlicks Subscription / CreditBalance. `EntitlementService.mergeSnapshot` already accepts grants — M8.5 fills them; does not fork creative pipeline. |
| D6 | Credit semantics | Prepaid credits are **entitlement fuel** for MOVIE_GENERATION (and optionally other meter kinds later). Spending happens at **authorizeGeneration** (or explicit debit API) — **not** inside Director compose. Free-tier GenerationAuthorization window remains for FREE rail; paid rails may raise caps via snapshot fields. |
| D7 | Free + ad-funded credits | Ad-funded / promotional credit grants are YouFlicks-owned ledger entries (grant source open string: `PROMO` \| `AD_SUBSIDY` \| `SUPPORT` …) — still **not** creative inputs. Exact economics = PO. |
| D8 | Webhooks | Idempotent `PaymentEvent` / external event id; reconcile → Subscription/CreditLedger. Job soft-name `BILLING_WEBHOOK` allowed. Ban `AI_BILL`. |
| D9 | Schema posture | New tables: `Subscription`, `CreditLedger` (append-only), optional `CreditBalance` projection, `PaymentEvent`. Open string statuses. **No** plan prices stored as CreativePlan fields. Prefer no product migration until impl gate. |
| D10 | UX | Checkout / manage subscription / buy credits / balance honesty — commercial chrome only. Hide vendor vocabulary. |
| D11 | Stage boundary | Architecture only this auth. **No** production BillingPort adapter, no live charges, no invented SKUs/prices in code. |
| D12 | Deps | Requires M8.2 EntitlementService + empty resolvers; M8.3 UsageEvent optional for ops reconciliation; M8.4 free policy remains for unpaid users. |

---

## 1. Objective

Let YouFlicks sell **subscription** and **prepaid credit** access that changes **EntitlementSnapshot** (rate, duration, watermark, ads flags, priority) — while the CreativePlan→Share pipeline stays identical in meaning.

Architectural rule: **Money buys gates and presentation policy. Money does not write the movie.**

---

## 2. Ports / services (soft)

```
BillingPort
  createCheckout(userId, offerKey) → CheckoutSession
  applyCredit(userId, packKey | grant) → CreditLedgerEntry
  cancelSubscription(userId) → …
  handleWebhook(providerKey, headers, rawBody) → WebhookResult  // idempotent

BillingService — authz, offer catalog lookup (config/PO), ledger writes, calls BillingPort
SubscriptionResolver / PrepaidResolver — read YouFlicks state into EntitlementService
```

Adapters: Stripe-shaped first candidate (impl choice); domain stores `providerKey` + `externalId` only.

---

## 3. Domain objects

| Object | Role |
| --- | --- |
| **Subscription** | userId, planKey (open string), status ACTIVE\|PAST_DUE\|CANCELED\|…, periodStart/End, externalRef, providerKey |
| **CreditLedger** | append-only: GRANT / SPEND / EXPIRE / REFUND / ADJUST; quantity; reason; related PaymentEvent? |
| **CreditBalance** | optional projection for fast authorizeGeneration |
| **PaymentEvent** | webhook audit; externalEventId unique; payload YouFlicks-owned summary — never raw secrets |
| **OfferCatalog** | config/data — planKey → entitlement grant shape; **prices live here or PO CMS**, not in creative schema |

---

## 4. Gate protocol (paid)

1. `EntitlementService.resolve` merges FREE defaults + SubscriptionGrant[] + PrepaidGrant[].  
2. If subscription active → raised caps / watermarkRequired/adsEnabled per grant (PO-defined).  
3. If prepaid remainingCredits > 0 and FREE rate exhausted → allow spend of credit for MOVIE_GENERATION (PO defines exchange).  
4. `INSUFFICIENT_CREDITS` when paid path required and balance empty.  
5. Constraints still land on **generation_authorization receipt** (M8.4) — never CreativePlan.

---

## 5. Boundary audit

| Risk | Proof |
| --- | --- |
| planKey in CreativePlan | validateCreativePlan reject-list; tests |
| BillingPort called from Director adapter | forbid imports; architecture test |
| Credit spend mutates StoryDocument | spend only in EntitlementService / BillingService |
| Webhook invents creative jobs | only Subscription/CreditLedger/PaymentEvent |

---

## 6. Must include / must not

**Include:** D1–D12; BillingPort; ledger; resolver wiring plan; webhook idempotency; boundary tests; minimized PO list.  
**Must not:** Invent consumer prices/SKUs; ship Stripe; mutate creative locks; AI_BILL; in-movie ads; NLE.

---

## 7. Impl decomposition (future Engineer gates)

| Slice | Purpose | Blocks on Brett? |
| --- | --- | --- |
| M8.5a | Schema + BillingService stubs + resolver reads empty→ledger | No (architecture-aligned scaffolding) — **optional** CoS call; prefer wait for catalog |
| M8.5b | Checkout + webhook + one live adapter | **Yes** — provider + at least one offer |
| M8.5c | Prepaid packs UX + spend path | **Yes** — pack economics |
| M8.5d | Refund/chargeback handling | **Yes** — refund posture |

Recommended: do **not** authorize M8.5a–d until minimized §H answers below.

---

## 8. Minimized Product Owner decisions (block M8.5 **ship**)

Architecture APPROVE does **not** invent these:

1. **Subscription catalog** — planKeys, display names, monthly/annual prices, entitlement benefits (gens/hour, max duration, watermark, ads, storage/priority).  
2. **Prepaid packs** — sizes, prices, expiry, what one credit buys (e.g. 1 credit = 1 MOVIE_GENERATION).  
3. **Refund / chargeback / tax** posture.  
4. **Production payment provider** (which BillingPort adapter goes live).

**Already decided (do not re-ask):** §H3 meter = AI_DIRECT/hour; §H5 free ads required; Constitution rails A/B/C.

**Autonomous within Constitution:** BillingPort shape, table shapes, webhook idempotency, Entitlement merge rules, deny codes, test strategy, refusal to put billing into creative meaning.

---

## 9. Self-review / Verdict

| Check | Result |
| --- | --- |
| Constitution §5 B/C + §4 billing≠creative | PASS |
| Parent PHASE_M8 M8.5 alignment | PASS |
| Hard-stop new principle? | No |
| Invented prices? | No |

### Verdict
**APPROVE** — `PHASE_M8_5_BILLING_ROADMAP_DECISION.md` as architecture lock. Implementation CLOSED.

---

## 10. Document control

- **Author:** YouFlicks Architect  
- **Date:** 2026-09-09  
- **Baseline:** `79ee97ee9ec39bc7354f672528642ebd1fa88463`  
- **This file sha256:** see sidecar `PHASE_M8_5_BILLING_ROADMAP_DECISION.md.sha256`
