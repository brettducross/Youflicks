# Phase 2F Roadmap Decision Document

**Status:** Proposal (not started)  
**Basis:** `ARCHITECTURE.md`, `README.md`, locked provider-agnostic rules, and `main` @ `95bca79`  
**Conflict resolved:** README names “Phase 2F” and forbids story/timeline/commercial Director adapter until that phase is requested; `ARCHITECTURE.md` has no 2F section and jumps from 2E → **Phase 3 — Story & timeline**. This document fills that gap.

---

## 1. Phase 2F objective

**Make the AI Director executable as YouFlicks-owned intelligence that produces a validated `CreativePlan`, without generating a film, story document, timeline, or render.**

Phase 2E shipped the *contract* (`DirectorInput`, `CreativePlan` schema, assemble/validate, capability gateway) with `container.aiDirector()` unconfigured. Phase 3 (per `ARCHITECTURE.md`) is *story & timeline persistence/UI*. Phase 2F is the missing middle: **run `AiDirectorPort.composePlan`, persist the plan as a first-class YouFlicks artifact, prove job-backed Director execution, and keep story/timeline/render deferred.**

This is **not** “start generating films.”

---

## 2. In-scope functionality

1. **First `AiDirectorPort` implementation** wired through `container.aiDirector()` — capability-driven, no vendor in domain. Prefer a **first-party / local or HTTP-behind-port** adapter that emits a `CreativePlan` matching `creativePlanSchema` (`schemaVersion: "1.0"`). A commercial host is optional and must stay behind the port + env, same pattern as `http.vision`.
2. **Director orchestration service** that:
   - calls existing `DirectorContractService.assembleInput`
   - invokes `AiDirectorPort.composePlan`
   - runs `DirectorContractService.validatePlan`
   - records provenance via existing attribution patterns (string keys only)
3. **Job-backed execution** using existing `JobType.AI_DIRECT` — HTTP must not run Director inline (same rule as analysis).
4. **YouFlicks-owned `CreativePlan` persistence** (new model or equivalent) — versioned plan JSON, project linkage, status, timestamps, optional provenance fields. **Do not** dump the plan into `StoryStructure.payload` yet (that is Phase 3’s owned story schema).
5. **Minimal studio surface** to request a plan and inspect the validated plan (read-only creative brief view). No NLE, no Generate Film marketing copy that implies a finished movie.
6. **Flip pipeline stage** `director` in `PIPELINE_STAGES` to available once exit criteria pass; leave `story` / `timeline` / `render` false.
7. **Tests** for assemble → compose → validate → persist; privacy denylist still holds; missing capability → typed error (no fake creative fallbacks).
8. **Docs update** in the same phase: add an explicit Phase 2F section to `ARCHITECTURE.md` and align README “Next phase” language so 2F ≠ Phase 3.

---

## 3. Explicitly out of scope

- Story generation / `StoryStructure` owned-schema population from the plan
- Timeline / `Timeline` / `TimelineClip` creation or review UI
- `RendererPort` implementation, render jobs, `FinishedMovie`
- Generate Film button that implies a finished movie
- Director chat / conversational UI
- Real evaluation scores (`createDirectorEvaluationBoundary` stays `NOT_IMPLEMENTED` unless trivially extended without inventing confidence)
- Ads marketplace, payments, billing
- Sponsorship influencing creative decisions
- Collapsing memory types into one “AI memory” table
- Vendor columns/enums in Prisma; teaching domain services vendor names
- Putting provider secrets in Prisma/source/browser
- Worker-process extraction / S3-R2 (nice-to-have parallel; not required to *define* 2F)
- Publishing / UFlix / social / mobile

---

## 4. Required interfaces / contracts

**Keep and consume (already authoritative from 2E):**

- `AiDirectorPort.composePlan(input: DirectorInput): Promise<CreativePlan>`
- `DirectorInput` privacy rules (`director/privacy.ts`)
- `creativePlanSchema` / `CREATIVE_PLAN_SCHEMA_VERSION = "1.0"`
- `DirectorCapabilityGateway` (availability / `require` — never returns `providerKey`)
- `DirectorContractService.assembleInput` / `validatePlan`
- Capability registry + `ProviderSelectionPolicy` for any Director-requested capabilities
- Typed errors: `DIRECTOR_INPUT_INVALID`, `DIRECTOR_CAPABILITY_UNAVAILABLE`, `DIRECTOR_PLAN_INVALID`, `DIRECTOR_PROVIDER_UNAVAILABLE`, `DIRECTOR_CONSTRAINT_CONFLICT`

**Add in 2F (thin):**

- `DirectorService` (or equivalent) orchestration over the contract + port + jobs + plan store
- Plan repository/port if persistence should stay swappable (optional; Prisma in service is consistent with current services style)
- Job payload contract for `AI_DIRECT` (projectId, userId, optional planRevision)

**Do not redefine** ports for Storage / Jobs / Analysis / Renderer in this phase.

---

## 5. Database changes (if any)

**Likely required:**

- New **`CreativePlan` (or `DirectorPlan`)** model, e.g.:
  - `id`, `projectId`, `schemaVersion`, `status` (DRAFT/READY/FAILED/SUPERSEDED)
  - `plan` JSON (YouFlicks-owned shape only)
  - provenance: `providerKey` string (attribution style, not vendor enum), optional `modelId` / `modelVersion`, `jobId`
  - `createdAt` / `updatedAt`; keep history (re-direct supersedes, does not delete)
- Optional: project status transition support toward `DIRECTING` when a job is running

**Not in 2F:**

- Changing `StoryStructure` / `Timeline` / `RenderJob` schemas for generation
- Vendor enums or sponsor→creative FKs
- Generic AI memory table

`StoryStructure.adapterKey` already exists for future Director linkage — **leave unused** until Phase 3 maps plan → story with a clear owned story document.

---

## 6. Services required

| Service | Role in 2F |
| --- | --- |
| `DirectorContractService` | Unchanged foundation: assemble + validate |
| **New `DirectorService`** | Request plan, enqueue `AI_DIRECT`, load/list plans, mark superseded |
| **New Director worker path** | Claim `AI_DIRECT`, call port, validate, persist, attribution |
| **New `AiDirectorPort` adapter** | Local deterministic and/or HTTP adapter; normalize host output at boundary |
| Existing Taste / Intent / Media / Analysis | Inputs only via assembleInput |
| Credits / Sponsorship | **Untouched** for creative path; credits may later list Director attribution using existing builder patterns |

`container.aiDirector()` becomes configured for the chosen adapter; `renderer()` stays throwing.

---

## 7. APIs / UI required (if any)

**APIs (authenticated, owner-only):**

- `POST /api/projects/:projectId/director/plan` → `202` + job (enqueue compose)
- `GET /api/projects/:projectId/director/plan` (latest) and/or `.../plans` (history)
- Optional: `GET .../director/input` debug/preview of assembled `DirectorInput` (never secrets/sponsors/storage keys)

**UI (minimal):**

- On project page: “Compose creative plan” (or equivalent) + status (Queued / Directing / Ready / Failed)
- Read-only plan viewer (concept, tone, decisions, rationale — fields that exist)
- **No** storyboard, timeline editor, render, or download movie

Health: extend `/api/health` with Director provider readiness (no secrets), mirroring analysis.

---

## 8. Acceptance criteria

- [ ] `ARCHITECTURE.md` defines Phase 2F explicitly; README “Next phase” points to Phase 3 (or named 2G) after 2F completes
- [ ] At least one `AiDirectorPort` adapter is registered; `container.aiDirector()` no longer throws `providerNotConfigured` in the configured env
- [ ] Compose is job-backed (`AI_DIRECT`); HTTP handlers return without waiting on model I/O
- [ ] Output always passes `validateCreativePlan` + privacy/constraint asserts before persistence
- [ ] Persisted plan is YouFlicks-owned JSON (`schemaVersion: "1.0"`); raw host JSON is not stored or shown
- [ ] Re-compose keeps prior plan rows (supersede pattern), analogous to re-analysis
- [ ] Sponsor data cannot enter Director input or plan generation path
- [ ] Domain code never branches on vendor names; no new vendor Prisma columns
- [ ] `PIPELINE_STAGES.director.available === true`; story/timeline/render still false
- [ ] No `StoryStructure` / `Timeline` / `RenderJob` / `FinishedMovie` writes from Director flow
- [ ] Typed failure when required Director capability is unavailable — no fake plan
- [ ] Tests cover privacy, validation, job path, and “unconfigured vs configured” adapter behavior

---

## 9. Dependencies on 2A–2E

| Phase | Why 2F depends on it |
| --- | --- |
| **1** | Auth, Prisma, ports, project shell |
| **2A** | Media inventory for `DirectorInput.mediaInventory` |
| **2B–2C** | Normalized `MediaAnalysis` + registry/policy; Director must not re-call vendors ad hoc for understanding already stored |
| **2D** | Taste + project intent → effective brief; attribution/credits patterns for provenance |
| **2E** | Entire contract stack 2F executes |

**Practical precondition:** projects used for Director compose should have ingest + at least technical analysis; HTTP vision remains optional. Empty media should fail with a clear typed/constraint error, not a hallucinated plan.

---

## 10. Deferred to Phase 2G / Phase 3

**Phase 2G (currently undefined in repo):** do **not** invent product scope under “2G” until needed. If a label is useful after 2F, reserve **2G** for *Director iteration & evaluation* (feedback → inferred `TasteSignal`, real `evaluate` boundary, plan revision loops) — still without story/timeline. Otherwise skip 2G and go 2F → Phase 3.

**Phase 3 — Story & timeline (authoritative in `ARCHITECTURE.md`):**

- Owned `StoryStructure` document derived from `CreativePlan` (normalizer; not raw model JSON)
- Timeline + clip records + review UI (not full NLE)
- Director/story services consuming ports only

**Later (4+):** render, publish, billing, worker extraction at scale, object storage, ads presentation after film complete.

---

## 11. Risks

1. **Scope creep into “Generate Film”** — UI wording and exit criteria must keep plan ≠ movie.
2. **Using `StoryStructure` as a plan dump** — would blur 2F/3 and invite vendor-shaped payloads; mitigate with a dedicated plan table.
3. **Commercial adapter before local contract proof** — harder to debug privacy/normalization; mitigate by shipping a **local/deterministic Director adapter first**, HTTP second (same playbook as local technical → `http.vision`).
4. **Request-coupled worker** — extending Next `after()` drain to `AI_DIRECT` inherits analysis stall risk; acceptable for 2F if documented; extraction remains later.
5. **Capability vacuum** — `STORY_REASONING` etc. have no adapters today; local Director may need to advertise/self-satisfy capabilities carefully without fake fallbacks.
6. **Doc drift** — without updating `ARCHITECTURE.md` when implementing, README “2F” and Phase 3 will keep colliding for future agents.

---

## 12. Recommended implementation sequence

1. Doc lock: write Phase 2F section into `ARCHITECTURE.md` + align README (decision recorded before code).
2. Prisma: `CreativePlan` (name TBD) model + migration; no story/timeline changes.
3. Local/`youflicks.local.director` adapter implementing `AiDirectorPort` (deterministic, testable).
4. `DirectorService` + `AI_DIRECT` worker path + attribution.
5. Authenticated plan APIs + minimal project UI (compose + view).
6. Optional HTTP Director adapter behind env (still normalize to `CreativePlan`).
7. Exit checklist, flip `PIPELINE_STAGES.director`, declare next phase = Phase 3 (and optionally reserve 2G for iteration).

---

## 13. Recommendation — what Phase 2F should be

**Phase 2F = Director Execution & Creative Plan Persistence.**

It sits cleanly between:

- **2E** — contracts only (`assembleInput` / `validatePlan` / unconfigured port)
- **Phase 3** — story structure + timeline from a validated plan

It preserves every locked 1–2E rule (provider-agnostic AI, sponsorship isolation, job-backed AI, no fake creative fallbacks, separate memory types).

It does **not** mean generating films. It means the platform can, for the first time, **ask the Director for a plan and keep that plan** as a YouFlicks-owned artifact — the bridge Phase 3 needs.

**Phase 2G:** leave undefined in product docs until after 2F ships; if needed later, use it for evaluation/iteration loops, not for story/timeline.
