# PO Decision — Selective Generation Foundation (Brett Ducross, 2026-09-25 07:09 PT)

Source analysis: /workspace/youflicks-locks/ARCH_TRACK2_SG_ECON_REFINEMENT_2026-09-25.md (sha256 b2891c1ceffd8bb88fd35504bbe4907f177ba51a2da7ac3c155334ec2b8690e4). Checked vs main d0bf0d8.
Verbatim PO text captured by Chief of Staff.

Approve the Selective Generation foundation work described in the Architect's `ARCH_TRACK2_SG_ECON_REFINEMENT_2026-09-25` analysis.

## Locked Product Owner decisions

### Routing scopes
Use: HERO, IDENTITY, NON_IDENTITY. Treat unknown identity conservatively as IDENTITY.

### Lane policy
HERO and IDENTITY may use only lanes that have passed the required quality gate for that scope.
NON_IDENTITY may use qualified draft-cost lanes.
A shot must never silently fall to an unqualified lane because the cheaper lane is available.

### Fallbacks
When no eligible generation lane exists:
- preserve original media where appropriate
- use Ken Burns/static treatment where appropriate
- or wait/fail honestly
A spend-cap hit must never trigger automatic retry.

### Regeneration
Initial ceilings: draft-cost lanes 3 attempts; other lanes 2 attempts.
After the ceiling is reached, move the shot up one qualified lane class or use a non-generation fallback.
Treat these as initial policy values, not permanent Constitution locks.

### Quality gates (provisional; must be validated against benchmark evidence)
- HERO/IDENTITY minimum resolution: 720p
- face similarity median >= 0.70
- face similarity minimum >= 0.55
- first-attempt keep rate: >= 60% non-identity; >= 50% identity/hero
- visual defects <= 10%
- failures <= 5%

### Formal bake-off
Authorize the DESIGN of a formal blind evaluation using 50 clips per lane per scope.
Do NOT authorize the spend for the bake-off yet.

### Provider policy
Do NOT designate Wan as the permanent default.
Treat current provider/model findings as benchmark/routing inputs only.
Do not lock any vendor.

## Authorize foundation implementation
1. Per-shot routing/fulfillment records outside CreativePlan and Timeline.
2. Lane registry using open `providerKey` values.
3. Correct lane-specific cost reservation.
4. Per-lane and per-shot cost metering.
5. AI-video seconds/budget accounting in addition to job limits.
6. Regeneration accounting and ceilings.
7. Shot role + identity state needed for routing.
8. Quality-gate telemetry.
9. Ken Burns/static fallback support.
10. Honest user messaging when no qualifying lane is available.
11. Multi-lane resolver support rather than one lane per process.

### Important boundary
Do not place routing economics inside CreativePlan, StoryStructure, or Timeline.
The creative pipeline decides what the movie should be. Fulfillment decides how to economically produce each shot.

### Do not authorize yet
Full provider bake-off; permanent vendor selection; large paid generation experiment; Wan default status; public beta; Launch Gate change; new commercial pricing.

LAUNCH_GATE = HOLD.
