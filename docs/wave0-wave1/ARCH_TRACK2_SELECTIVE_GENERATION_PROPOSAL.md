# Track 2 — Selective Generation Architecture (PROPOSAL)

**Status:** Architecture proposal only — **NOT** a PHASE lock. Does **not** amend M3–M8.  
**Authority:** Brett-authorized via CoS 2026-09-10. Architect draft.  
**Baseline:** origin/main `2a7939c` (R1 Replicate gateway CLOSED).  
**Constraints:** Provider-neutral; no permanent vendor; commercial economics outside creative meaning; no paid generation in this doc; no Creative Director interrupt; no code.

---

## 1. Bottom Line

Selective generation is a **fulfillment policy** around `AssetGeneratorPort`, not a new storytelling grammar.

- **Creative meaning** stays in CreativePlan → StoryStructure → Timeline (`unmetMediaRoles`, roles, dramatic function).
- **Treatment class** (original photo / original video / simple motion / lower-cost gen / premium I2V / other) is chosen by a **SelectiveGenerationPolicy** at asset-fulfillment time.
- **Budget / entitlement / spend caps** remain **gates** (M8 Entitlement + gateway SpendGuard + EngineCostEvent) — they may **deny or defer** premium calls; they must **not** rewrite plot, acts, or cut meaning.
- Only some moments deserve premium generation. That decision is explicit, auditable, and reversible — never silent Director cost-minimizing.

No new architectural principle is required if we place the policy **outside** Director/Story/Timeline compose ports. Escalate to PO only for product knobs listed in §7.

---

## 2. Goal

Maximize **cinematic improvement per unit of generation cost**: spend expensive `VIDEO_GENERATION` (e.g. premium I2V) where motion/identity payoff is highest; otherwise prefer original media, simple motion treatments, or cheaper capabilities — while keeping the free/paid movie on the **same** CreativePlan→Share quality path (Constitution: no crippled free fork).

---

## 3. Treatment classes (YouFlicks-owned; not vendors)

Open string `treatmentClass` (provenance / policy output). Illustrative set:

| Class | Intent | Typical capability / source | Relative cost |
|-------|--------|----------------------------|---------------|
| `ORIGINAL_PHOTO` | Still placed as-is (or Ken Burns at render) | `MediaAsset` IMAGE | ~0 gen |
| `ORIGINAL_VIDEO` | User clip as-is | `MediaAsset` VIDEO | ~0 gen |
| `SIMPLE_MOTION` | Camera/env motion without premium I2V (render/policy or cheap effect) | Render presentation / future low-cost adapter | Low |
| `LOWER_COST_GENERATION` | Cheaper gen (shorter, lower res, non-I2V image/video) | `IMAGE_GENERATION` / capped `VIDEO_GENERATION` | Med |
| `PREMIUM_I2V` | High-payoff image→video (R1 recipe class) | `VIDEO_GENERATION` via gateway | High |
| `OTHER_GENERATED` | VO/music/SFX/enhancement when needed | `VOICE_SYNTHESIS` / `MUSIC_*` / … | Varies |
| `DEFER` / `UNMET` | Leave role unmet until budget or user action | none | 0 |

Classes are **not** Prisma enums. Adapters advertise capabilities; policy maps role → class → capability call (or skip).

---

## 4. Decision locus (critical boundary)

```
Story / Timeline (meaning, roles, unmetMediaRoles)
        ↓ read-only cues
SelectiveGenerationPolicy.decide(role, cues, budgetSnapshot)
        ↓ treatmentClass + capability + constraints
AssetService / AI_ASSET enqueue (or skip / defer)
        ↓
AssetGeneratorPort (provider-neutral) → gateway/adapters
        ↓
GeneratedAsset + open providerKey  OR  keep MediaAsset
        ↓
Explicit Timeline Rebuild may place GENERATED_ASSET clips (existing M3 D9)
```

**ALLOW**

- Policy reads: role string, kind hints, `unmetMediaRoles` reason, story scene dramatic function / duration targets (already StoryDocument), optional user “own-footage-only”, EntitlementSnapshot remaining budget, EngineCost remaining / gateway caps.
- Policy writes: fulfillment plan artifact (ops) — e.g. `AssetFulfillmentPlan` or job payload fields: `treatmentClass`, `capability`, `maxSpendUsd`, `deferReason`. **Not** CreativePlan JSON.
- Commercial gate: `authorizeGeneration` / credit / gateway `SpendGuard` may reject premium class → degrade to `DEFER` or `SIMPLE_MOTION` with **user-visible honesty**.

**FORBIDDEN**

- Billing/ads/cost inside Director/Story/Timeline compose.
- Silent StoryDocument truncation or “cheap plot” because free tier.
- Hard-wiring Kling/Runway/Replicate/Wan into domain or Prisma enums.
- Treating R1 motion recipe as permanent vendor lock (recipe = transport settings; substitutable).

---

## 5. Scoring cues (cinematic improvement heuristic)

Policy inputs (v1, replaceable):

1. **Coverage:** Is there already a good `MediaAsset` for this role? Prefer original.
2. **Motion need:** Still that must live vs already-moving video.
3. **Dramatic weight:** Hero/arrival/emotional beat vs B-roll texture (from Story dramaticFunction / scene purpose — **cue**, not cost field).
4. **Identity risk:** Faces/people → prefer ORIGINAL or carefully constrained I2V; avoid gratuitous morph risk.
5. **Duration budget:** Short premium beats > long cheap wallpaper.
6. **Marginal gain:** If SIMPLE_MOTION / original already “good enough” for the cut, skip premium.
7. **Remaining spend:** From Entitlement + EngineCost + gateway caps — **outside** creative ports.

Output: ordered list of roles with treatmentClass + estimated cost band; user/product may show honesty (“3 premium moments, 12 originals”).

---

## 6. Fit to existing locks

| Lock | Fit |
|------|-----|
| Constitution | Billing ≠ creative; free movie genuine path; provider neutrality |
| M3 | `unmetMediaRoles` + per-role `AssetGeneratorPort.generate`; Rebuild explicit |
| M4–M7 | Mechanical render / keep / share unchanged |
| M8 | Entitlement gates + EngineCostEvent ops-only; watermark/ads presentation |
| R1 gateway | Premium I2V = one treatment behind `/v1/generate`; swap backend via env |
| R1 motion recipe | Optional **settings profile** for `PREMIUM_I2V` class — not domain default |

**Principle escalation:** None required for this proposal. Soft product decisions → §7.

---

## 7. PO decisions (not blocking architecture draft)

1. Default premium density (e.g. max N `PREMIUM_I2V` per free movie vs paid).
2. Whether users can force “own-footage-only” or “premium all unmet”.
3. Whether SIMPLE_MOTION is render-time Ken Burns vs a cheap gen adapter.
4. Customer-visible credit/cost honesty (M8.3 Brett note).
5. Raise/lower live caps beyond R1 `$8` / `10` jobs.

---

## 8. Milestone candidates (impl later; not authorized here)

| ID | Name | Purpose | Depends |
|----|------|---------|---------|
| **SG.0** | Policy contract | `SelectiveGenerationPolicy` + `treatmentClass` open strings + tests that CreativePlan rejects commercial fields | — |
| **SG.1** | Cue extraction | Read-only cues from Story/Timeline/Media without schema meaning change | SG.0 |
| **SG.2** | Budget binding | Wire Entitlement + EngineCost + gateway caps into decide() degrade/defer | M8.2/M8.3, R1 caps |
| **SG.3** | Premium I2V profile | Apply R1 motion-recipe **profile** as one configurable treatment (env/model open strings) | R1 gateway |
| **SG.4** | Original-first path | Auto-prefer MediaAsset when role satisfied; honest unmet leave | M3 |
| **SG.5** | Simple motion | Render/presentation Ken Burns or low-cost adapter — no Director rewrite | M4 |
| **SG.6** | UX honesty | Surface “which moments are premium” without vendor chrome | SG.0–2 |
| **SG.7** | Multi-vendor swap test | Same policy → fal **or** Replicate backends; provenance `providerKey` only | R1 |

Suggested sequencing: **SG.0 → SG.1 → SG.4 → SG.2 → SG.3 → SG.5 → SG.6**.

---

## 9. Non-goals

- Permanent provider selection.
- Changing CreativePlan/Story/Timeline/Render **semantics**.
- In-movie ads.
- Implementing code in this track.
- Claiming finished-movie QA (Creative Director owns quality gate).

---

## 10. Architect stance

**APPROVE as proposal direction** (Architect autonomous within Constitution). Ready for CoS to schedule SG.* under separate Engineer auth. Final product knobs (§7) remain Brett PO.
