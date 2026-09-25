# Track 2 — Selective Generation: Economics Refinement Addendum (2026-09-25)

**Status:** **DRAFT · ANALYSIS ONLY · non-PHASE · NOT a lock amendment.** This is an addendum to `ARCH_TRACK2_SELECTIVE_GENERATION_PROPOSAL.md` (sha256 `bbeaafe39519ba63c842b5083cf9dc5d1f2c528173f28bf3277a63802b216d90`, same bytes as `docs/wave0-wave1/` copy on main). It does not change that proposal, any PHASE lock, the Constitution, or M3–M8 semantics.
**Author:** Architect (executor draft), 2026-09-25 PT.
**Main checked:** `d0bf0d8fdf7ef4830ddb2621e586d0e594a9785b` (merge of PR #27, committed 2026-09-11 07:46 PT). Read on 2026-09-25 about 06:55 PT from a shallow read-only clone, which was deleted afterwards. The GitHub REST API was rate-limited for unauthenticated calls.
**Not authorized by this document:** code, PRs, branches, schema migrations, spend, paid API calls, a bake-off, a Creative Director keep evaluation, vendor selection, production routing changes. **LAUNCH_GATE: HOLD.**

**Rate provenance rule:** every $/s below comes from the PO planning input (via CoS) or a cited Economics file line. Labels: **VERIFIED** means Economics marked it VERIFIED. **ESTIMATE** means derived arithmetic. **ASSUMPTION** means a modeling choice. **UNVERIFIED** covers quality, identity, keep, and Elo claims. **PROPOSED** marks a number that needs a PO decision.

---

## 0. Rate inputs and reproduction check

Formula (planning input): `billed_s = T × f × r`. `COGS = billed_s × c`, with T = 300 s, f = 0.10, r = 1.5, so billed_s = 300 × 0.10 × 1.5 = **45 s**.

| # | Lane (candidate, not selected) | Proposed lane class | c ($/s) | Source | 45 × c | Planning input | Reproduces? |
|---|---|---|---:|---|---:|---:|---|
| A1 | Creatify Boreal 720p | draft-cost | 0.010 | `draft_lane_pruna_list_only_2026-09-24.csv` L2 (VERIFIED) | 0.450 | ~$0.45 | YES |
| A2 | Pruna P-Video-2-Pro 480p COST | draft-cost (480p, fails §5 G1 floor) | 0.010 | same CSV L3 (VERIFIED LIST) | 0.450 | ~$0.45 | YES |
| A3 | Pruna P-Video-2-Pro 768p COST | draft-cost | 0.025 | same CSV L6 | 1.125 | ~$1.12 | YES, with a rounding note. 1.125 is shown as 1.12 (round-half-even). The CSV stores 1.125. |
| A4 | H3 Max Turbo 768p / Pruna 480p QUALITY | draft-quality | 0.040 | same CSV L9 / L5 | 1.800 | ~$1.80 | YES |
| A5 | Pruna P-Video-2-Pro 768p QUALITY | draft-quality (upper band) | 0.075 | same CSV L8 | 3.375 | ~$3.38 | YES (3.375 → 3.38, also half-even) |
| A6 | Wan 2.7 720p (live R1 lane via Replicate) | standard | 0.100 | same CSV L11 (source "fal") | 4.500 | ~$4.50 | YES, but see note N1 |

**All six anchor numbers reproduce.** No number needed correcting. The only nuance is the half-even rounding of x.xx5 values in A3 and A5.

Hero/premium candidates. Rates come from Economics files. They are quality-UNVERIFIED and not selected:

| Lane | c ($/s) | Source | Note |
|---|---:|---|---|
| Kling v3 Pro, audio off | 0.112 | `unit_costs.json` L6 `video_kling_pro_audio_off_per_s` (as of 2026-09-09); `draft_lane_per_sec.csv` L7 "VERIFIED, fal Kling v3 Pro" | `01-video-gen-pricing.md` L29 flags **Med** uncertainty: a fal article quotes $0.224/$0.336. The rate is 16 days old, so re-verify it. |
| Seedance 2.0 Fast (audio included) | 0.2419 | `draft_lane_per_sec.csv` L12 "VERIFIED, fal explore 2026-09-09"; `01-video-gen-pricing.md` L31 | Also 16 days old. Seedance 2.0 Standard is $0.3024/s (`01-video-gen-pricing.md` L32). |
| Seedance "Draft" | — | none | This is a workflow feature, not a discounted SKU, so **no rate is modeled**. |

- **N1:** Economics sources the $0.10/s figure for Wan 2.7 from the **fal** page. No Economics file lists a **Replicate** Wan 2.7 rate. The only Replicate evidence is the R1 lock estimate of "~$0.50" per 5 s job (`R1_MOTION_RECIPE_LOCKED_2026-09-10.md`), which works out to 0.50 / 5 = $0.10/s. That is consistent, but it is an **ESTIMATE** for the live transport, not a verified list rate.
- **N2:** Identity and keep quality for **every** lane above, including Wan 2.7, is **UNVERIFIED**. Wan 2.7 has only informal PO QA (R1 lock). Arena Elo is not evidence of YouFlicks keep quality.
- **N3:** **No image-generation $/unit exists** in the Economics files (searched `unit_costs.json`, `01-*`, `02-*`, and all draft-lane files). Still-image and Ken Burns costs are therefore **parameters**; see §3.

---

## 1. Routing: draft lane vs premium lane

### 1.1 Lane classes and registry (config, not schema)

Lane classes are **open strings**: `draft-cost`, `draft-quality`, `standard`, `premium`. A YouFlicks-owned **lane registry config** maps each class to one or more `providerKey` open strings. The registry is a file or env JSON read by the fulfillment side. It is **never** a Prisma enum or a hard-coded vendor.

```jsonc
// ILLUSTRATIVE SHAPE ONLY. Entries are candidates, enabled:false, no selection implied.
{
  "registryVersion": "sg-lanes-draft-0",
  "floor": { "minPixelArea": 900000 },            // PROPOSED, see §5 G1
  "lanes": [
    { "laneId": "L-dc-1", "laneClass": "draft-cost",    "providerKey": "<open string>", "usdPerS": 0.010, "rateRef": "econ:pruna_list_only_2026-09-24.csv#L2", "maxClipS": 5, "pixelArea": 921600, "gate": { "scope": [], "status": "NOT_EVALUATED" }, "enabled": false },
    { "laneId": "L-dq-1", "laneClass": "draft-quality", "providerKey": "<open string>", "usdPerS": 0.040, "rateRef": "econ:…#L9", "gate": { "scope": [], "status": "NOT_EVALUATED" }, "enabled": false },
    { "laneId": "L-std-r1", "laneClass": "standard",    "providerKey": "replicate:wan-video/wan-2.7-i2v", "usdPerS": 0.100, "rateRef": "econ:…#L11 + R1 est", "gate": { "scope": ["R1_INFORMAL"], "status": "INFORMAL_ONLY" }, "enabled": true },
    { "laneId": "L-prem-1", "laneClass": "premium",     "providerKey": "<open string>", "usdPerS": 0.112, "rateRef": "econ:unit_costs.json#L6", "gate": { "scope": [], "status": "NOT_EVALUATED" }, "enabled": false }
  ],
  "regenCeiling": { "draft-cost": 3, "draft-quality": 2, "standard": 2, "premium": 2 },   // PROPOSED, see §4
  "escalation": { "draft-cost": "draft-quality", "draft-quality": "standard", "standard": "premium" }
}
```

`gate.scope` ⊆ {`NON_IDENTITY`, `IDENTITY`, `HERO`}. A lane can serve a shot only if the shot's required scope is in `gate.scope` with `status: PASSED`. **All low-cost lanes (draft-cost, draft-quality) start with an empty scope, so they are ineligible for identity and hero shots until §5 passes.**

### 1.2 Inputs (all read-only cues, computed fulfillment-side)

| Input | Derivation (evidence on main) | Notes |
|---|---|---|
| `shotRole` ∈ {hero, identity, establishing, insert, transition, dialogue-closeup} | Derived from `StoryScene.dramaticFunction` (8 values: exposition, inciting, development, turning, climax, resolution, motif, punctuation), `mediaRoles[].role/purpose`, `dialogueOutline`, clip position, `unmetMediaRoles[].reason` | **NOT FOUND** as a field on main. It is a derived cue and is **never written back** into Story or Timeline. |
| `identityBearing` (bool) | Start-frame `MediaAnalysis.payload.people.people[].faceDetected`, `recurringPersonIds` (`src/server/analysis/schema.ts`) | Fail-safe: unknown counts as `true`. |
| `motionNeed` ∈ {none, low, high} | Analysis `cameraMovement`, `sceneDescription`; role/purpose text (vehicles, water, arrival…) | Heuristic v1 |
| `slotS` (screen time) | `TimelineClip timelineEndMs − timelineStartMs` for the unmet slot, or the StoryAct `targetDurationMs` share | |
| `planBudgetUsd` | **NEW**: per-plan AI-video budget. `EntitlementSnapshot` on main has only `planKind`, `movieGenerationsPerHour`, `maxOutputDurationMs`, `watermarkRequired`, `adsEnabled` | PO sets the numbers (E9) |
| `movieRemainingUsd` / `gatewayRemaining` | Per-movie remainder (NEW) and gateway `SpendGuard.snapshot()` (`maxSpendUsd − spendUsd`, `maxJobs − jobsAccepted`) | Gateway ledger is global and cumulative today |
| `lane.gate`, `lane.health` | Registry + gateway `GET /health` `ok` flag (`server.ts`) | |
| `attemptsSoFar[laneClass]` | Fulfillment record (NEW). Partially derivable from the `GeneratedAsset.replacesAssetId` chain | `Job.attempts` counts worker retries, not creative regens |

### 1.3 Rules

1. **Original first (SG.4).** If a `MediaAsset` covers the slot, use it. The treatment is ORIGINAL_* and there is no routing.
2. **Selective filter (§2).** If §2 says HOLD, KEN_BURNS, or REUSE, there is no generation call.
3. **Required scope.** `hero` needs HERO. `identity` and `dialogue-closeup`, or any shot with `identityBearing = true`, need IDENTITY. Everything else needs NON_IDENTITY.
4. **Target class.** hero → `premium`. identity → `premium`. establishing, insert, and transition → `draft-cost`. If the shot's `motionNeed = high` and `slotS ≥ 4`, `draft-quality` is allowed as the target.
5. **Eligibility filter.** Keep lanes that are `enabled`, healthy, advertise `VIDEO_GENERATION`, meet the pixel-area floor, have `gate.status = PASSED` covering the required scope, and have `attemptsSoFar < regenCeiling`.
6. **Budget fit.** `estUsd = min(slotS, maxClipS) × usdPerS`, which is one attempt. The attempt must satisfy `estUsd ≤ min(movieRemainingUsd, planBudgetUsd − spentUsd, gatewayRemainingUsd)`. For the first attempt, use `estUsd × r_expected[class]` so the policy does not start shots it cannot finish.
7. **Downgrade only within eligibility.** A shot may drop from premium to standard, draft-quality, or draft-cost **only if** the lower lane's gate covers the shot's scope. Identity and hero shots **never** fall to a non-gated lane. They fall back to SIMPLE_MOTION (Ken Burns) or DEFER.
8. **Escalate on regen ceiling.** After N attempts on class X without a keep, move to `escalation[X]` if it is eligible and fits the budget. Otherwise keep the best DRAFT asset only if the keep verdict allows it, else use SIMPLE_MOTION.
9. **Honesty.** Every downgrade, defer, or cap hit is surfaced to the user (SG.6) and recorded with a `decisionReason`.

### 1.4 Pseudocode (fulfillment side, outside the Director, Story, and Timeline ports)

```ts
function routeShot(shot: ShotCues, ctx: FulfillCtx): RouteDecision {
  if (ctx.originalCovers(shot)) return { treatment: "ORIGINAL", reason: "coverage" };
  const sel = selectiveTreatment(shot, ctx);                // §2
  if (sel !== "GENERATE") return { treatment: sel, reason: "selective" };

  const scope = shot.role === "hero" ? "HERO"
              : (shot.identityBearing || shot.role in {identity, "dialogue-closeup"}) ? "IDENTITY"
              : "NON_IDENTITY";
  let cls = targetClass(shot);                              // rule 4
  while (cls) {
    const lanes = ctx.registry.byClass(cls).filter(l =>
      l.enabled && ctx.health(l) && l.caps.includes("VIDEO_GENERATION") &&
      l.pixelArea >= ctx.registry.floor.minPixelArea &&
      l.gate.status === "PASSED" && l.gate.scope.includes(scope) &&
      ctx.attempts(shot, cls) < ctx.registry.regenCeiling[cls]);
    for (const l of lanes) {                                // registry order = config preference
      const est = Math.min(shot.slotS, l.maxClipS) * l.usdPerS;
      if (ctx.fitsBudget(est, cls)) return { treatment: "GENERATE", laneClass: cls, laneId: l.laneId, providerKey: l.providerKey, estUsd: est };
    }
    cls = nextClass(cls, scope, ctx);   // down if budget-bound and lower class eligible for scope,
                                        // up if the ceiling was hit and the next class is eligible; else null
  }
  return scope === "NON_IDENTITY" && !ctx.budgetExhausted()
    ? { treatment: "SIMPLE_MOTION", reason: "no eligible lane" }
    : { treatment: ctx.hasStill(shot) ? "SIMPLE_MOTION" : "DEFER", reason: "gate/budget/cap" };
}
// Gateway 429 GATEWAY_SPEND_CAP: never retry the same shot. Mark CAP_HIT and fall back as above.
```

### 1.5 Decision table

| # | Shot role / scope | Lane gate status | Budget | Lane health | Attempts | → Decision |
|---|---|---|---|---|---|---|
| D1 | any; original covers | — | — | — | — | ORIGINAL (0 gen) |
| D2 | hero (HERO) | premium PASSED(HERO) | fits | up | < N | premium |
| D3 | hero | no premium lane PASSED(HERO) | — | — | — | SIMPLE_MOTION on best still, or DEFER. **Never a draft lane.** (E3: whether the R1 standard lane may serve heroes pre-gate is a PO call.) |
| D4 | hero | premium PASSED | does not fit | up | — | standard only if standard is PASSED(HERO); else SIMPLE_MOTION |
| D5 | identity / dialogue (IDENTITY) | premium or standard PASSED(IDENTITY) | fits | up | < N | cheapest PASSED(IDENTITY) lane in {premium, standard} |
| D6 | identity | only draft lanes available, not PASSED(IDENTITY) | — | — | — | SIMPLE_MOTION (dialogue: HOLD). **Draft ineligible.** |
| D7 | establishing / insert / transition (NON_IDENTITY) | draft-cost PASSED(NON_IDENTITY) | fits | up | < 3 | draft-cost |
| D8 | same | draft-cost PASSED | fits | **down** | — | next draft-cost lane, then draft-quality if PASSED, then SIMPLE_MOTION |
| D9 | same | draft-cost PASSED | fits | up | **= 3 (ceiling)** | escalate to draft-quality (≤ 2), then standard (≤ 2), then SIMPLE_MOTION |
| D10 | same | no lane PASSED(NON_IDENTITY) | — | — | — | standard (R1 lane) under R1 caps if PO keeps the R1 default (E3); else SIMPLE_MOTION |
| D11 | any | any | **cap hit** (plan, movie, or gateway 429) | — | — | SIMPLE_MOTION or DEFER + honest UX; no retry |
| D12 | any | gate REVOKED mid-movie | — | — | — | treat as not PASSED; already-kept assets stay (no silent re-roll) |

---

## 2. Selective-generation criteria (what gets generated)

Treatments (open strings from the proposal §3): `ORIGINAL_VIDEO`, `ORIGINAL_PHOTO` (HOLD), `SIMPLE_MOTION` (Ken Burns or parallax on a still), `REUSE` (an existing READY `GeneratedAsset`, with different `sourceInMs/sourceOutMs`), `GENERATE` (routed per §1), `DEFER`.

| # | Rule (PROPOSED defaults; PO knobs) | Outcome |
|---|---|---|
| S1 | A user video covers the slot at usable quality (analysis `visualQuality`) | ORIGINAL_VIDEO |
| S2 | `slotS < 2.0 s`, or role is `transition`/`punctuation` | HOLD or KEN_BURNS. Never generate: a 5 s R1 clip billed for a ≤ 2 s slot wastes ≥ 60% of the billed seconds (≥ 3 of 5 s). |
| S3 | `motionNeed = none` (portrait, document, static landscape) | KEN_BURNS (a subtle zoom, ≤ 1.1× scale, is a render parameter) |
| S4 | Dialogue close-up (scene has `dialogueOutline` + face) | ORIGINAL_VIDEO if present, else HOLD or very subtle Ken Burns. No generative mouth motion (fabricated speech). A PO call (E12). |
| S5 | Identity-bearing, `motionNeed ≥ low` | GENERATE only through an IDENTITY-gated lane (§1 D5). Else KEN_BURNS. |
| S6 | Hero beat (`climax`/`turning`/`inciting`, or Director `scene_emphasis`), `motionNeed = high`, `slotS ≥ 3 s` | GENERATE premium (§1 D2) |
| S7 | Establishing (`exposition`, first shot of the scene, location cue, no face), `motionNeed ≥ low` | GENERATE draft-cost (§1 D7), else KEN_BURNS |
| S8 | Repeat location: same analysis `locations` value **and** same start-frame asset as an existing READY GeneratedAsset in the project | REUSE a different in/out range. Limit ≤ 2 placements per clip per movie and never adjacent. |
| S9 | Insert/detail B-roll `3 ≤ slotS < 5` | GENERATE draft-cost if the fill budget remains, else KEN_BURNS |
| S10 | `slotS > 5 s` | One 5 s generated clip + HOLD/KEN_BURNS tail, or split across slots. Generated seconds per shot are capped at the lane `maxClipS` (R1 profile = 5 s) unless hero. |

**Link to fill %.** The fill budget in generated seconds is `G = f_max × T`. Policy ranks GENERATE candidates by hero, then identity (only if a gated lane exists), then motion-high establishing, then inserts. It allocates 5 s clips until G is used. Everything left over becomes KEN_BURNS or HOLD.
- Example: T = 300 s, f = 10% gives G = 30 s = **6 clips × 5 s**. With p = 20% premium, that is 6 s of premium, which rounds to **1 hero clip** (5 s, so p_eff = 5/30 = 16.7%) plus 5 draft clips.
- At r = 1.5 the expected generation calls are 6 × 1.5 = **9 jobs**. That is **9 of the 10 jobs** under the current beta gateway default (`BETA_DEFAULT_MAX_JOBS = 10`, `src/server/beta/defaults.ts`). One light-fill movie nearly exhausts the global cap (E9).

---

## 3. Cost-per-finished-minute model

**Parameters:**
- T: runtime (s)
- f: generated-video fraction of runtime
- p: premium fraction of generated seconds
- r_d, r_p: regen multipliers (billed s ÷ kept s) for the draft and premium parts
- c_d, c_p: $/s for each part
- n_img, r_img, c_img: count, regen, and $ per generated still. **c_img is NOT FOUND in Economics**, so it is a parameter.
- c_kb: incremental Ken Burns cost. It is **$0 generation** on an existing still. Render compute is already in the non-video stack (`unit_costs.json` `render_compute_per_finished_min` = $0.02 for the whole render, not incremental).

```
COGS_video(T)      = T·f·[(1−p)·r_d·c_d + p·r_p·c_p] + n_img·r_img·c_img + n_kb·c_kb
$/finished-minute  = 60·f·[(1−p)·r_d·c_d + p·r_p·c_p] + (n_img·r_img·c_img + n_kb·c_kb)/(T/60)
```

With f = 0.10 and r = 1.5, the per-minute factor is 60 × 0.10 × 1.5 = **9 billed s per finished minute**.

### 3.1 Anchor rows (single lane, p = 0; stills are original, so c_img terms = 0)

| Lane | c | 5-min COGS = 45·c | $/finished-min = 9·c |
|---|---:|---:|---:|
| A1 Boreal 720p | 0.010 | 0.45 | **0.090** |
| A2 Pruna 480p COST | 0.010 | 0.45 | **0.090** |
| A3 Pruna 768p COST | 0.025 | 1.125 | **0.225** |
| A4 H3 Turbo 768p / Pruna 480p QUALITY | 0.040 | 1.80 | **0.360** |
| A5 Pruna 768p QUALITY | 0.075 | 3.375 | **0.675** |
| A6 Wan 2.7 (R1 standard) | 0.100 | 4.50 | **0.900** |
| Kling v3 Pro audio-off (Econ 09-09) | 0.112 | 5.04 | 1.008 |
| Seedance 2.0 Fast (Econ 09-09) | 0.2419 | 10.886 | 2.177 |

Because the per-minute cost is linear in T, these per-minute figures hold for any runtime at the same f and r. That matches `DRAFT_LANE_COST_SENSITIVITY_2026-09-15.md` §2: Wan $0.900 at 1.5, 5, and 10 min.

### 3.2 Mixed rows (T = 300 s, f = 0.10 → 30 generated s)

| # | Mix | Arithmetic | 5-min COGS | $/min |
|---|---|---|---:|---:|
| M1 | 80% Boreal + 20% Wan 2.7 (premium stand-in), r 1.5/1.5 | 30 × (0.8·1.5·0.01 + 0.2·1.5·0.10) = 30 × (0.012 + 0.030) | **1.26** | 0.252 |
| M2 | 80% Pruna 768 COST + 20% Wan, r 1.5/1.5 | 30 × (0.030 + 0.030) | **1.80** | 0.360 |
| M3 | 80% H3 Turbo + 20% Wan, r 1.5/1.5 | 30 × (0.048 + 0.030) | **2.34** | 0.468 |
| M4 | 80% Boreal + 20% Kling Pro, r 1.5/1.5 | 30 × (0.012 + 0.2·1.5·0.112 = 0.0336) | **1.368** (matches Econ $1.37) | 0.274 |
| M5 | 80% Pruna 768 COST + 20% Kling Pro | 30 × (0.030 + 0.0336) | **1.908** (matches Econ $1.91) | 0.382 |
| M6 | 80% Boreal + 20% Seedance 2.0 Fast | 30 × (0.012 + 0.2·1.5·0.2419 = 0.07257) | **2.537** | 0.507 |
| M7 | 80% Boreal @ **r 2.0** + 20% Wan @ r 1.5 | 30 × (0.8·2·0.01 + 0.030) = 30 × 0.046 | **1.38** | 0.276 |
| M8 | 80% Boreal @ **r 3.0** + 20% Wan @ r 1.5 | 30 × (0.024 + 0.030) | **1.62** | 0.324 |
| M9 | 90% Boreal + 10% Wan, r 1.5 | 30 × (0.9·1.5·0.01 + 0.1·1.5·0.10) = 30 × (0.0135 + 0.015) | **0.855** | 0.171 |
| M10 | M1 at **f = 20%** | 60 × 0.042 | **2.52** | 0.504 |
| Ref | 100% Wan 2.7 (status quo R1) | 45 × 0.10 | 4.50 | 0.900 |

- **Read:** M1 cuts video COGS by 72% against the status quo (1.26 vs 4.50). About 71% of the M1 cost (0.90 / 1.26) is the 20% premium part.
- Draft-lane regen matters less than premium share. Going from M1 to M8 (draft r 1.5 → 3.0) adds only $0.36.

---

## 4. Regeneration sensitivity and crossovers

COGS (T = 300 s, f = 10%, so 30 kept s) = 30 × r × c:

| Lane (c) | r 1.0 | r 1.5 | r 2.0 | r 3.0 | r 4.0 | r 5.0 |
|---|---:|---:|---:|---:|---:|---:|
| draft-cost 0.010 (A1/A2) | 0.30 | 0.45 | 0.60 | 0.90 | 1.20 | 1.50 |
| draft-cost 0.025 (A3) | 0.75 | 1.125 | 1.50 | 2.25 | 3.00 | 3.75 |
| draft-quality 0.040 (A4) | 1.20 | 1.80 | 2.40 | 3.60 | 4.80 | 6.00 |
| draft-quality 0.075 (A5) | 2.25 | 3.375 | 4.50 | 6.75 | 9.00 | 11.25 |
| standard 0.100 (A6) | 3.00 | 4.50 | 6.00 | 9.00 | 12.00 | 15.00 |
| premium 0.112 (Kling Pro) | 3.36 | 5.04 | 6.72 | 10.08 | 13.44 | 16.80 |
| premium 0.2419 (Seedance Fast) | 7.26 | 10.89 | 14.51 | 21.77 | 29.03 | 36.29 |

**Crossover.** A cheap lane (c_c) matches a pricier lane (c_e) running at regen r_e when `r* = c_e·r_e / c_c`. If each attempt independently keeps with probability k, then r = 1/k (geometric). So the break-even per-attempt keep rate is `k* = 1/r*`.

| Cheap c_c | vs c_e @ r_e | r* | k* (min keep rate) |
|---:|---|---:|---:|
| 0.010 | 0.025 @ 1.0 / 1.5 | 2.5 / 3.75 | 40% / 26.7% |
| 0.010 | 0.040 @ 1.0 / 1.5 | 4.0 / 6.0 | 25% / 16.7% |
| 0.010 | 0.075 @ 1.5 | 11.25 | 8.9% |
| 0.010 | **0.100 @ 1.0** / 1.5 | **10.0** / 15.0 | 10% / 6.7% |
| 0.010 | 0.112 @ 1.0 | 11.2 | 8.9% |
| 0.025 | 0.040 @ 1.5 | 2.4 | 41.7% |
| 0.025 | **0.075 @ 1.5** / 1.0 | **4.5** / 3.0 | 22.2% / 33.3% |
| 0.025 | 0.100 @ 1.0 / 1.5 | 4.0 / 6.0 | 25% / 16.7% |
| 0.040 | 0.075 @ 1.5 | 2.81 | 35.6% |
| 0.040 | 0.100 @ 1.0 / 1.5 | 2.5 / 3.75 | 40% / 26.7% |
| 0.075 | 0.100 @ 1.0 / 1.5 | 1.33 / 2.0 | 75% / 50% |
| 0.100 | 0.112 @ 1.0 / 1.5 | 1.12 / 1.68 | 89% / 59.5% |
| 0.100 | 0.2419 @ 1.0 | 2.42 | 41.3% |
| 0.112 | 0.2419 @ 1.0 | 2.16 | 46.3% |

**Architectural implications:**
1. **Cost crossover is rarely the binding constraint for $0.01/s lanes.** They stay cheaper than standard up to r ≈ 10, which needs a keep rate of only ≥ 10%. What binds instead is **keep quality**: a lane that never passes an identity keep has r → ∞. That is why the gate (§5), not price, decides eligibility.
2. **Mid-band lanes cross over fast.** $0.075 vs $0.10 crosses at r 1.33 (k ≥ 75%) against standard at r 1.0. A5 needs near-incumbent keep quality to justify itself.
3. **Per-shot regen ceiling with escalation (PROPOSED).** With a ceiling of N attempts, then escalation to a lane with regen r_e, the expected $/kept-s is `c_c·(1−(1−k)^N)/k + (1−k)^N·c_e·r_e`.
   - Example: draft-cost 0.01 with N = 3, escalating to standard 0.10 at r_e 1.0:
     - k = 50% → 0.01·1.75 + 0.125·0.10 = **$0.0300/s**
     - k = 30% → 0.01·2.19 + 0.343·0.10 = **$0.0562/s**
     - k = 10% → 0.01·2.71 + 0.729·0.10 = **$0.1000/s**, no saving against going straight to standard at r 1.0
   - **PROPOSED ceilings:** draft-cost N = 3, draft-quality N = 2, standard N = 2, premium N = 2.
   - **Lane-level circuit breaker:** if a lane's rolling per-attempt keep rate for a shot scope falls below `1.5 × k*` against its escalation target (for 0.01 vs 0.10 @ 1.0 that is 15%), route that scope straight to the next class and alert.
4. **SpendGuard misprices lanes today.** It reserves a flat `estimatedUsdPerJob` (default 0.5, `config.ts` L108) whatever the lane or duration.
   - A 5 s draft-cost job actually costs 5 × 0.01 = $0.05, so it is over-reserved 10×.
   - A 5 s Seedance Fast job costs 5 × 0.2419 = $1.21, so it is under-reserved 2.4×.
   - Per-lane `usdPerS × durationS` estimation is required before multi-lane routing (SG.2).

---

## 5. Quality gates before a low-cost lane can be an identity or hero default

All thresholds are **PROPOSED for PO decision**. Gates are evaluated per lane × scope (NON_IDENTITY, IDENTITY, HERO). The incumbent standard lane runs as a **blind control** in every comparison.

| Gate | Metric | PROPOSED threshold | Applies to |
|---|---|---|---|
| G1 Resolution floor | Output pixel area | **≥ 900,000 px** (≈ 1280×720; the R1 Wan output 1508×610 = 919,880 px passes). 480p tier ≈ 854×480 = 409,920 px **fails**. | Any lane in a delivered cut. 480p lanes can only be preview/iteration unless PO waives the floor or authorizes an upscale step (ENHANCEMENT cost NOT FOUND). |
| G2 Identity consistency | Face-embedding cosine similarity, generated frames vs reference face from the start frame (sampled ≥ 1 fps) | Median ≥ 0.70 and per-clip min-frame ≥ 0.55, **and** non-inferior to control: lower 95% CI of (lane − control) ≥ −0.03. The embedding model is fixed in the eval protocol, and absolute values are calibrated on the control first. | IDENTITY, HERO |
| G3 Keep rate | Creative Director keep verdicts, first attempt | NON_IDENTITY ≥ 60%; IDENTITY/HERO ≥ 50% **and** within 10 pts of control; cumulative keep within the §4 ceiling ≥ 90% | all |
| G4 Regen-to-keep | Attempts ÷ kept clips (measured r) | ≤ 0.5 × r* against the escalation target, and ≤ 3.0 absolute. For 0.01 vs 0.10 @ 1.0 the formula gives ≤ 5, so 3.0 binds. | all |
| G5 Artifact / temporal flicker | Share of clips the CD flags for face morphing, limb distortion, flicker, or warping; an automated temporal-consistency score is telemetry only | NON_IDENTITY ≤ 10%; IDENTITY/HERO ≤ 5% | all |
| G6 Prompt/brief adherence | CD 1–5 rating vs role purpose and brief | ≥ 4 on ≥ 80% of clips, non-inferior to control | all |
| G7 Operability | Provider failure, refusal, and timeout rate; p95 latency within `YF_GATEWAY_TIMEOUT_MS` (300,000 ms) | failures ≤ 5%; p95 < 300 s | all |

**Evidence required:**
- Same inputs across lanes, including the control.
- **Blind**: `providerKey` and lane are hidden from the Creative Director.
- Randomized order.
- **N ≥ 50 clips per lane × scope.** For IDENTITY: ≥ 10 distinct people across ≥ 5 consenting families/sets.
  - At N = 50 a 60% keep rate has a 95% CI of ±1.96·√(0.6·0.4/50) = **±13.6 pts**.
  - At N = 100 it is **±9.6 pts**. PO may require N = 100 for IDENTITY/HERO defaults.
- Results are recorded with the registry `gate` entry (evidence ref, date, N, CIs). They are **not** stored as a Prisma enum.
- Face embeddings are biometric-adjacent data. The consent and retention posture must be settled first (E11).

**Sign-off chain (all three, in order):**
1. **Creative Director** keep verdict (quality)
2. **Architect** conformance (registry/config only, open `providerKey`, telemetry complete, no creative-meaning writes)
3. **PO final** approval before any default change

**Explicit:** the Creative Director keep evaluation and any bake-off **each require separate PO authorization**. **This document authorizes neither.** No paid calls are made or implied here.

---

## 6. SUPPORTED vs NEW, verified against main `d0bf0d8`

| Item | Status | Evidence on main (path; model/field names) | New work → SG milestone |
|---|---|---|---|
| `VIDEO_GENERATION` capability | **EXISTS** | `src/server/ports/capabilities.ts` `AssetCapability.VIDEO_GENERATION`; `gateways/yf-asset/contract.ts` `KIND_TO_GATEWAY_CAPABILITY.VIDEO_CLIP → VIDEO_GENERATION`; gateway `parseCapabilities` defaults to it (`config.ts` L178–191) | none |
| Gateway `/v1/generate` | **PARTIAL (single lane per process)** | `gateways/yf-asset/server.ts`, `generate.ts`. One `providerKey`/`backend`/`model` per process (`YfAssetGatewayConfig`). Per-request `model` override exists (`resolveModel`, `generate.ts` L181–193), but job `providerKey` stays `config.providerKey`. Job store is an in-memory `Map` (`jobs.ts` L34–36). | Multi-lane dispatch: one gateway per lane or a lane-aware gateway, with provenance correct per lane → **SG.3 / SG.7** |
| `AssetGeneratorPort` + HTTP adapter | **EXISTS / PARTIAL** | `src/server/ports/asset-generator.ts` (`generate(input)`); `src/server/adapters/assets/http-asset.ts` (`HttpAssetGeneratorAdapter`, always sends `config.model`; attribution `modelId = config.model`); `src/server/assets/provider-config.ts` `resolveAssetGeneratorAdapter` returns **one** adapter (HTTP if configured, else local non-prod) | Lane-aware resolver behind the port (the port signature stays unchanged) → **SG.0 / SG.3** |
| Open `providerKey` | **EXISTS** | `String` on `GeneratedAsset`, `CreativePlan`, `Timeline`, `ProviderAttribution`, `EngineCostEvent`, `MediaAnalysis` (`prisma/schema.prisma`). Default `http.asset` or `replicate:${model}` (`config.ts` L79–81). **Zero `enum` blocks** in the schema. | Registry maps laneClass → providerKey strings → **SG.0** |
| Backends `fal \| http \| replicate \| mock` | **EXISTS** | `YF_ASSET_GATEWAY_BACKENDS` (`config.ts` L11); `createBackend` (`server.ts` L60–68): mock → `MockVideoBackend`, replicate → `ReplicateVideoBackend`, else `HttpQueueVideoBackend` (fal preset / http). Unset backend defaults to `fal` (model `fal-ai/ltx-video`). Replicate default `wan-video/wan-2.7-i2v` is commented "not a domain default". | Swap test across backends → **SG.7** |
| Spend caps: `SpendGuard` / `PrismaSpendLedger` / durable caps | **EXISTS (durable, fail-closed) / PARTIAL for SG** | `spend.ts` `SpendGuard`; `ledger.ts` `PrismaSpendLedger` (`SELECT … FOR UPDATE` on `gateway_spend_ledger`); model `GatewaySpendLedger{id, jobsAccepted, spendUsd}`; `server.ts` requires `DATABASE_URL` for live backends; `assertGatewaySecrets` fails closed without caps; `beta/defaults.ts` 10 jobs / $8; ledger id `"yf-asset"` is **one global cumulative row**, with no window, user, movie, or lane. Estimate is a flat `estimatedUsdPerJob` (0.5). `/api/ops/spend` reads it. | Per-lane `usdPerS × durationS` reservation; per-movie and per-plan AI-video budget; per-lane sub-caps → **SG.2** (budget numbers are PO, E9) |
| Entitlement gate | **EXISTS / PARTIAL** | `services/entitlement.ts` `requirePaidEnqueue` (emailVerified, quarantine, consent) called in `AssetService.requestGenerate`; `EntitlementSnapshot` has no AI-video budget field (`entitlement/types.ts` L38–47) | Plan AI-second/USD budget in the entitlement layer (not CreativePlan) → **SG.2** |
| `GeneratedAsset` model | **EXISTS** | Fields `status` (DRAFT/READY/SUPERSEDED/FAILED), `kind`, `origin`, `role`, `durationMs`, `width`, `height`, `providerKey`, `capability`, `modelId`, `timelineId/Version`, `storySceneId`, `replacesAssetId` (regen lineage), `jobId`, `inputFingerprint`, `payload`. **No** laneClass, treatmentClass, regenCount, gate, or cost fields. | Adding columns here = **ESCALATION** (M3 lock). **Recommend** instead a fulfillment-side record (below) linked by `generatedAssetId`; laneClass is derivable from `providerKey` via the registry → **SG.0 / SG.2** |
| `CreativePlan` | **EXISTS** | Model `CreativePlan{plan Json, providerKey, capability…}`. `director/validate.ts` `COMMERCIAL_PLAN_KEYS` rejects `planKind`, `engineCost`, `costUnits`, `adsEnabled`, …; tests in `director/schema.test.ts`. `creativePlanSchema` is **`.passthrough()`**, so keys like `laneClass`/`providerKey`/`treatmentClass`/`usdPerS` would currently pass validation. | Extend the denylist test to routing keys (proposal SG.0 already calls for this). It touches M1 validation, so confirm (E8). **No** per-shot fields in CreativePlan → **SG.0** |
| `Timeline` / `TimelineClip` | **EXISTS** | `Timeline` model; `timeline/schema.ts` clip `.strict()` with `sourceKind MEDIA_ASSET\|GENERATED_ASSET`, `mediaRole`, `storySceneId`, `timelineStartMs/EndMs`, `sourceInMs/OutMs`, transitions `CUT\|DISSOLVE\|FADE`; `unmetMediaRoles[{role, storySceneId?, reason?}]` | Consume as read-only cues; REUSE uses existing `sourceInMs/OutMs`. **No** routing fields (strict schema, M2/M3 locks) → **SG.1** |
| Story / analysis cues | **EXISTS** | `story/schema.ts` `dramaticFunction` (8), `purpose`, `mood`, `pacing`, `mediaRoles`, `dialogueOutline`, act `targetDurationMs`; `analysis/schema.ts` `people.faceDetected`, `recurringPersonIds`, `locations`, `cameraMovement`, `visualQuality` | Cue extractor → **SG.1** |
| Usage / cost metering | **PARTIAL** | `UsageEvent`/`EngineCostEvent{providerKey, capability, costUnits, costKind}`; `AssetService` records `ASSET_CALL` quantity 1; `usage/cost-table.ts` flat 50 units/`ASSET_CALL`, "not currency" | Per-shot/per-lane billed seconds + est/actual USD (ops-only) → **SG.2** |
| Provider selection policy | **PARTIAL (analysis only)** | `analysis/selection.ts` `ProviderSelectionPolicy` / `PreferredThenFirstPolicy`. No equivalent for assets. | Precedent for `SelectiveGenerationPolicy` + lane selection → **SG.0** |
| `SelectiveGenerationPolicy` module | **NOT FOUND → NEW** | — | **SG.0** (contract), **SG.1** (cues), **SG.4** (original-first) |
| Lane registry config | **NOT FOUND → NEW** | — | **SG.3** (premium profile as one entry), **SG.7** (multi-lane swap) |
| Shot-role / generation-mode / laneClass / chosen providerKey / regenCount per shot | **NOT FOUND → NEW** (fulfillment-side) | Regen is partially derivable from the `replacesAssetId` chain; `Job.attempts` counts worker retries only | New ops record (soft name `AssetFulfillmentDecision`, cf. proposal §4 `AssetFulfillmentPlan`): `projectId, timelineId, timelineVersion, role, storySceneId, attemptNo, shotRoleCue, identityBearing, motionNeed, treatmentClass, laneClass, laneId, providerKey, gateStatusAtDecision, billedS, estUsd, actualUsd?, keepVerdict?, decisionReason, generatedAssetId?`. A new YouFlicks-owned table, not a locked model; still needs Engineer auth → **SG.0 / SG.2** |
| Quality-gate telemetry | **NOT FOUND → NEW** | — | Per-lane × scope keep, regen, artifact, identity-score rollups. **Gap:** no SG milestone owns this explicitly. Propose folding it into **SG.7**, or adding SG.7a. |
| Ken Burns / SIMPLE_MOTION on stills | **NOT FOUND** | No zoom/motion fields in `render/schema.ts` manifest or the renderer adapters | **SG.5**. If a motion parameter is needed in the render manifest, that touches M4 → possible ESCALATION (E7). |
| UX honesty ("n premium moments") | **NOT FOUND** | `components/account/entitlement-honesty.tsx` exists for entitlements only | **SG.6** |

**Boundary recommendation:** keep **all** routing metadata (shot role cue, laneClass, providerKey chosen, regen count, gate status, cost) in the fulfillment-side record and ops tables. CreativePlan, StoryStructure, Timeline, and GeneratedAsset meaning stay untouched. `GeneratedAsset.providerKey` (already provenance) plus the registry is enough to recover the lane class after the fact.

---

## 7. ESCALATIONS (PO decisions / lock changes)

1. **E1 Gate thresholds:** approve or modify §5 G1–G7 and N (50 vs 100).
2. **E2 Resolution floor vs 480p lanes:** whether the ≥ 900k px (≈ 720p) delivery floor holds. If it does, A2 and the 480p QUALITY lanes are preview/iteration only unless an upscale step is authorized (its cost is not in Economics).
3. **E3 Wan 2.7 as the R1 default:** whether it stays the R1/standard default, and whether it may serve identity and hero shots before any formal gate (it has informal QA only). The Replicate rate is an ESTIMATE (N1).
4. **E4 Hero-lane choice:** Kling Pro vs Seedance vs other. **Not selected here.** The Kling rate has Med uncertainty, and both rates date from 09-09.
5. **E5 Bake-off authorization:** requires separate PO spend authorization.
6. **E6 Creative Director keep-evaluation authorization:** separate PO authorization.
7. **E7 Locked-model schema changes:** any per-shot field on `GeneratedAsset` (M3), `Timeline`/`TimelineClip` (M2/M3), `CreativePlan` (M1), `StoryStructure`, or a render-manifest motion parameter (M4) is a lock change. **Recommend avoiding these via the fulfillment-side record.**
8. **E8 CreativePlan denylist extension:** adding routing keys to `COMMERCIAL_PLAN_KEYS` is hardening in M1 validation. Confirm it is in scope for SG.0 and not a lock change.
9. **E9 Budget numbers:** per-plan (FREE/PLUS/FAMILY) AI-video seconds or USD per movie. Also gateway cap sizing: today's 10 jobs / $8 is global and cumulative, which is about one light-fill movie (9 jobs).
10. **E10 Regen ceilings and regen metering:** the §4 N values, and whether user-initiated regens are included or metered (`PO_MARGINAL_COST_BRIEF` Q3).
11. **E11 Consent/privacy for identity evaluation:** face embeddings on family photos are biometric-adjacent. Consent, retention, and a vendor no-training posture are needed (W0-3, B-EXT-*).
12. **E12 Dialogue close-ups:** the product rule against generative mouth motion (S4).
13. **E13 Premium density default:** p per plan (proposal §7.1). The 20% here is an ASSUMPTION.

---

## 8. Hard-constraint conformance checklist

| Constraint | Status |
|---|---|
| No vendor selection | PASS. Lanes are "candidates", registry entries `enabled:false`, hero choice escalated (E4). |
| No production authorization / routing change | PASS. Analysis only, LAUNCH_GATE HOLD. |
| No spend / paid API calls / bake-off | PASS. Only file reads plus a public read-only clone. |
| No code, PR, or branch; no lock files edited | PASS. One new markdown file + `.sha256`. The clone was deleted. |
| No Constitution / PHASE / M3–M8 amendment | PASS. Schema-touching options are escalated (E7/E8), and the recommended path avoids locked models. |
| Open `providerKey`; no Prisma vendor enums | PASS. Registry maps open-string classes to open-string keys, and main has zero `enum` blocks. |
| Commercial / ads / cost outside creative meaning | PASS. Budget and cost stay in the entitlement layer, SpendGuard, and ops records; CreativePlan denylist hardening is proposed. |
| Low-cost lanes ineligible for identity/hero until gated | PASS. §1 rules 3/5/7, D3/D6. |
| Creative Director keep eval and bake-off not authorized | PASS. Stated in §5. |
| LAUNCH_GATE | **HOLD** (unchanged). |
