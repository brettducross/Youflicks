# Phase M8.5 Roadmap Decision Document — Billing / Subscription / Prepaid Credits

**Status:** Approved architecture specification — **amended 2026-09-10** (Brett PO commercial lock) — implementation authorized **within this lock**; **no invented prices/numbers**  
**Milestone name:** M8.5 — BillingPort (Subscription + Prepaid pay-to-play)  
**Basis:** Original Architect APPROVE 2026-09-09; **AMENDMENT** after Brett PO commercial decisions LOCKED 2026-09-10 (CoS → Architect); Product Constitution (sha256 `a9921097cf60aa6d0245ad8d50bd866a4169910b19a56af42811029b40857917`); parent PHASE_M8 (sha256 `a7c5b54aaf733918b6324ba0a16bfbe17427fe1bb4cd17f883729973984f4ccd`); free-platform M8.1–M8.4 (+M8.4.1) complete on main  
**This document:** Authoritative architecture for M8.5. Engineer may implement scaffolding and adapters **without inventing prices, pack sizes, or numeric caps**. Live charges / checkout require payment provider + offer catalog prices from PO. Refund posture still unanswered — blocks **M8.5d ship only**.

**Filename (locked):** `PHASE_M8_5_BILLING_ROADMAP_DECISION.md`  
**Do not** mutate PHASE_2F–M7, Product Constitution, or parent PHASE_M8 to ease billing.

Authoritative repo: `github.com/brettducross/Youflicks`.

---

## 0. Locked decisions

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | CreativePlan→…→Publication + M8.1–M8.4 platform gates unchanged in meaning. Billing never writes creative payloads. |
| D2 | M8.5 identity | **BillingPort** + YouFlicks-owned commercial records: Subscription, CreditLedger/CreditBalance, PaymentEvent. Constitution access models **B (Subscription)** and **C (Prepaid)**. |
| D3 | Critical separation | Billing ≠ creative intelligence. PlanKind / prices / credit balances never enter CreativePlan / Story / Timeline / GeneratedAsset / Render meaning. EntitlementService is the only path from paid grants → generation gates. |
| D4 | Provider neutrality | Payment processors = adapters behind **BillingPort**. Open `providerKey`. **Never** Prisma vendor enums. |
| D5 | Tier planKeys (Brett 2026-09-10) | Open-string planKeys: **`FREE`** · **`PLUS`** (primary individual) · **`FAMILY`** (preferred early family segment). Prices and exact numeric benefits **TBD** — do not invent. Grant **shapes** (flags + placeholder benefit fields) may ship with TBD/null caps. |
| D6 | Credit semantics (**AMENDED**) | Prepaid credits are a **provider-neutral usage/credit abstraction** for **variable engine consumption** — **do NOT hard-assume 1 credit = 1 movie / 1 AI_DIRECT**. Debits derive from metered usage (M8.3 kinds / quantity / EngineCostEvent-informed policy) behind Entitlement/Billing services — **never** inside Director compose. Customer-facing presentation stays simple. **Initial credit expiry = NEVER**; unused credits must **not** silently disappear. **Subscribers MAY buy prepaid.** Free-tier GenerationAuthorization window remains for FREE rail; PLUS/FAMILY raise caps via SubscriptionGrant fields (numbers TBD). |
| D7 | Ad-funded credits | Ledger source `AD_SUBSIDY` (and `PROMO` / `SUPPORT`) — entitlement only; **capped** (cap TBD). Never unlimited expensive consumption; no creative meaning change. Bridge detailed in M8.6. |
| D8 | Webhooks | Idempotent `PaymentEvent`; reconcile → Subscription/CreditLedger. Soft job `BILLING_WEBHOOK`. Ban `AI_BILL`. |
| D9 | Schema posture | `Subscription`, `CreditLedger` (append-only; EXPIRE type reserved but default policy NEVER expires), optional `CreditBalance`, `PaymentEvent`. OfferCatalog holds planKey → grant shape; **prices** only when PO supplies them. |
| D10 | UX | Checkout / manage / buy credits / balance honesty — commercial chrome. Hide vendor vocabulary. FAMILY UX (profiles, shared library, parental controls) may land as entitlement + productization — not creative forks. |
| D11 | Stage boundary | Impl planning + engineering **authorized within this lock**. **No** invented prices, pack sizes, or numeric caps. Live payment adapter needs PO provider + priced offers. |
| D12 | Deps | M8.2 EntitlementService + resolvers; M8.3 UsageMeter for spend abstraction; M8.4 free policy for FREE users. |
| D13 | PLUS / FAMILY grant direction (Brett) | **PLUS:** watermark off, ads off, higher usage, longer movies, more storage, higher priority/capability — **exact numbers TBD**. **FAMILY:** same direction as PLUS + larger storage, family profiles, shared library, parental/family controls, collaboration where supported — **exact numbers TBD**. |

---

## 1. Objective

Sell **PLUS** / **FAMILY** subscriptions and **prepaid credits** that change **EntitlementSnapshot** only — CreativePlan→Share meaning unchanged.

Architectural rule: **Money buys gates and presentation policy. Money does not write the movie.**

---

## 2. Ports / services (soft)

```
BillingPort
  createCheckout(userId, offerKey) → CheckoutSession
  applyCredit(userId, packKey | grant) → CreditLedgerEntry
  cancelSubscription(userId) → …
  handleWebhook(providerKey, headers, rawBody) → WebhookResult

BillingService — authz, OfferCatalog, ledger, BillingPort
UsageCreditPolicy — maps UsageEvent/EngineCost (or authorize intent) → credit debit quantity (config; no hard-coded 1:1 movie)
SubscriptionResolver / PrepaidResolver — fill EntitlementService.mergeSnapshot
```

---

## 3. Domain objects

| Object | Role |
| --- | --- |
| **Subscription** | userId, planKey (`PLUS` \| `FAMILY` \| …), status, period, externalRef, providerKey |
| **CreditLedger** | GRANT / SPEND / REFUND / ADJUST / EXPIRE(reserved); quantity; reason; never silent drop |
| **CreditBalance** | projection |
| **PaymentEvent** | webhook audit |
| **OfferCatalog** | planKey/packKey → grant shape + optional price when PO sets it |

---

## 4. Gate protocol (paid)

1. `resolve` merges FREE defaults + SubscriptionGrant[] + PrepaidGrant[].  
2. Active PLUS/FAMILY → grant flags (watermark/ads off, raised caps when numbers exist).  
3. Prepaid: if policy allows spend, debit **usage-abstracted** credits (not hard 1 AI_DIRECT = 1 credit).  
4. `INSUFFICIENT_CREDITS` when paid path required and balance empty.  
5. Constraints still on **generation_authorization receipt** (M8.4) — never CreativePlan.

---

## 5. Boundary audit

| Risk | Proof |
| --- | --- |
| planKey / credits in CreativePlan | reject-list + tests |
| BillingPort in Director adapter | forbid imports |
| 1:1 movie hard-code in domain | UsageCreditPolicy config; tests forbid constant 1 MOVIE_GENERATION = 1 credit as sole path |
| Silent credit disappearance | no background EXPIRE without PO policy; initial NEVER |

---

## 6. Must include / must not

**Include:** D1–D13; BillingPort; usage/credit abstraction; FREE/PLUS/FAMILY planKeys; never-expire default; subscriber prepaid allowed; boundary tests.  
**Must not:** Invent prices/pack sizes/numeric caps; ship live charges without PO provider+prices; mutate creative locks; AI_BILL; assume 1 credit = 1 movie.

---

## 7. Impl decomposition

| Slice | Purpose | Blocks on Brett? |
| --- | --- | --- |
| **M8.5a** | Schema + BillingService + CreditLedger + UsageCreditPolicy stub + resolvers; planKeys FREE/PLUS/FAMILY grant **shapes** with TBD numeric fields | **No** — first Engineer auth candidate |
| **M8.5b** | Checkout + webhook + one live BillingPort adapter | **Yes** — payment provider + at least one **priced** offer |
| **M8.5c** | Prepaid pack UX + spend path wired to UsageCreditPolicy | Pack **prices/sizes** TBD (telemetry); structure **No**; live sell **Yes** prices |
| **M8.5d** | Refund/chargeback handling | **Yes** — refund posture **still unanswered** |

---

## 8. Product Owner decisions

### Still open (ship blockers)
1. **Exact prices** and numeric benefits for PLUS/FAMILY (after telemetry).  
2. **Prepaid pack sizes/prices** and UsageCreditPolicy coefficients (after telemetry).  
3. **Refund / chargeback / tax** posture — blocks **M8.5d only** (not M8.5a).  
4. **Production payment provider**.

### Locked 2026-09-10 (do not re-ask)
Tiers FREE/PLUS/FAMILY; prepaid YES; not 1:1 movie; expiry NEVER initially; subscribers may buy prepaid; unused credits no silent loss; ad-funded credits YES capped later; commercial≠creative; no invented prices.

---

## 9. Self-review / Verdict

| Check | Result |
| --- | --- |
| Brett 2026-09-10 commercial lock | PASS (D5/D6/D7/D13) |
| Credit ≠ 1:1 movie | PASS (D6 amended) |
| Invented prices? | No |
| New principle? | No |

### Verdict
**AMEND → APPROVE** — amended `PHASE_M8_5_BILLING_ROADMAP_DECISION.md`. M8.5a Engineer auth recommended next.

---

## 10. Document control

- **Author:** YouFlicks Architect  
- **Dates:** 2026-09-09 APPROVE; **2026-09-10 AMEND** (Brett PO)  
- **This file sha256:** see sidecar `PHASE_M8_5_BILLING_ROADMAP_DECISION.md.sha256`
