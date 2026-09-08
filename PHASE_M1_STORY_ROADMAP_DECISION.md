# Phase M1 Roadmap Decision Document — Story from Plan

**Status:** Approved specification — not implemented
**Milestone name:** M1 — Story from plan (CreativePlan → StoryStructure)  
**Basis:** Brett M1 gate approvals (2026-09-08); Architect post-2F roadmap + M1 detailed specification (2026-09-08); Architect lock review APPROVE WITH AMENDMENTS then FINAL APPROVE (2026-09-08); ChatGPT co-approval pending/not recorded in CoS session; Phase 2F COMPLETE & Architect-approved at checkpoint `29eef55e0640dfc77236f73f0d8002835d4e1b62`; prior architectural lock `3e11c41` (`PHASE_2F_ROADMAP_DECISION.md`); locked provider-agnostic rules  
**This document:** Authoritative specification for a **future** M1 implementation. M1 is **not started in code**. Do not treat this file as evidence that StoryStructure population / story composition exists. **Architect APPROVED this lock (2026-09-08). Implementation remains CLOSED until CoS authorizes Engineer under this lock.**

**Filename (locked):** `PHASE_M1_STORY_ROADMAP_DECISION.md` at repository root, beside `PHASE_2F_ROADMAP_DECISION.md`. Do **not** overwrite or mutate `PHASE_2F_ROADMAP_DECISION.md`. Do not use `M1_ROADMAP_DECISION.md` as the repo filename.

Authoritative Git repository: clean public `github.com/brettducross/Youflicks`.  
**Do not** merge, cherry-pick, or reuse the obsolete historical Cursor workspace (old 2F/2G/2H/2I, including FilmBlueprint-via-StoryStructure salvage). Treat `29eef55` as the authoritative implementation checkpoint.

`ARCHITECTURE.md` historically lumps **“Phase 3 — Story & timeline.”** This lock **splits** that into M1 (this document) and M2 (future lock). After this lock is merged, a follow-on docs sync may point `ARCHITECTURE.md` / README at the M1 lock and note the M1/M2 split — that sync does **not** invent scope inside this lock.

---

## Locked decisions (Brett — 2026-09-08)

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Port boundary | **StoryComposerPort** only — new provider-neutral port. **Never** extend or overload `AiDirectorPort`. `AiDirectorPort` remains the Phase 2F boundary for CreativePlan composition. |
| D2 | Schema | **StoryDocument schema v1** field tree locked in §4. `targetDurationMs` = narrative/structural **target only** — never editorial timing; optional on **acts only**. |
| D3 | M2 editing | **Deferred.** M1 has no scene dragging, reordering, timeline editing, or other NLE behavior. M2 UI (review-only vs minimal edit) remains open until M2 architecture. |
| D4 | M3–M6 | **Deferred** (GeneratedAsset representation, renderer, playback/VLC, FinishedMovie promotion). |
| D5 | Milestone numbering | **M1–M8 approved** (§10). M8 may proceed parallel but must **never** own or influence creative meaning. |
| D6 | Provenance | Every StoryStructure version derives from **exactly one READY CreativePlan version**. Prior StoryStructure versions preserved. Rebuild must **never** silently mutate the source CreativePlan relationship. |
| D7 | Hard M1 boundary | StoryStructure owns **narrative structure**, not editorial execution (§3). |

---

## 1. Objective

Turn a READY, versioned YouFlicks-owned `CreativePlan` into a validated, versioned YouFlicks-owned `StoryStructure` / `StoryDocument`, **and nothing beyond that**.

Phase 2F shipped Director execution and first-class CreativePlan persistence:

**AI_DIRECT → Director → validated CreativePlan → versioned CreativePlan persistence**

M1 **runs** the next boundary:

**(M1) StoryComposerPort → validated StoryDocument → versioned StoryStructure persistence**

This is **not** generating a film, timeline, assets, render, playback, library, share/export, or product-platform work.

**Architectural rule:** `StoryStructure` ≠ renamed `CreativePlan`. It adds narrative structure (acts / scenes / beats, dramatic function, media **roles**, VO/dialogue outlines, duration **targets**) with provenance to the source CreativePlan id/version. It must **not** own editorial timing, tracks, cut lists, transitions, render, or provider JSON.

---

## 2. Must include

1. **First-class versioned `StoryStructure` persistence**
   - Project-linked
   - Versioned (preserve previous versions; do not overwrite)
   - **`StoryStructure.status`:** `DRAFT` | `READY` | `SUPERSEDED` | `FAILED`
   - **In-progress belongs on the Job** (`PENDING` | `RUNNING` | …), **not** on StoryStructure rows
   - Validated YouFlicks-owned `StoryDocument` JSON (schema v1)
   - Provenance (§5)
   - Job linkage
   - Timestamps
   - On recompose: create a **new** version; set prior READY to `SUPERSEDED` as required; do **not** silently mutate prior rows’ CreativePlan relationship

2. **`StoryComposerPort` (provider-neutral)**
   - Locked shape: `composeStory(input: StoryComposerInput) → StoryDocument`
   - Do **not** overload `AiDirectorPort`
   - Mirror Phase 2F **attribution-outside-port** pattern
   - No provider names in domain logic
   - No provider-specific JSON persisted as architectural truth
   - Adapters remain replaceable

3. **Test/local deterministic adapter (allowed, limited)**
   - Allowed for tests, development, and contract verification
   - Must **not** masquerade as production AI
   - Must **not** falsely mark production story composition available

4. **Honest production capability**
   - Story composition available only when a genuine configured adapter exists behind `StoryComposerPort`
   - Missing capability → typed error
   - No fake creative fallback

5. **`StoryService` + `StoryWorker`**
   - Assemble `StoryComposerInput` from READY CreativePlan (+ required consume fields)
   - Request composition through `StoryComposerPort`
   - Validate returned `StoryDocument`
   - Persist versioned `StoryStructure`
   - Record attribution outside the port return where required

6. **Asynchronous job path**
   - **Job type: `AI_STORY`** (parallel to Phase 2F `AI_DIRECT`)
   - HTTP enqueues work → **202**
   - Composition runs on the worker path — no long-running AI inside HTTP
   - Job status carries in-progress (`PENDING` | `RUNNING` | …); StoryStructure rows use only `DRAFT` | `READY` | `SUPERSEDED` | `FAILED`

7. **Provenance continuity (locked)**
   - Every StoryStructure version derives from **exactly one READY CreativePlan version**
   - Example: CreativePlan v3 READY → StoryStructure v1; CreativePlan v4 READY → StoryStructure v2
   - Previous StoryStructure versions remain preserved
   - Rebuild must never silently mutate the source CreativePlan relationship

8. **Recompose continuity (mirror 2F `priorDecisions`)**
   - When a prior READY StoryStructure exists, assemble `StoryComposerInput` with that document (or a defined narrative subset) for continuity
   - Do **not** invent a chat system
   - Do **not** read Timeline

9. **Reproducibility**
   - Persist originating `jobId`
   - Persist input fingerprint/hash of assembled story input
   - Persist `creativePlanId`, `creativePlanVersion`, optional `planFingerprint`
   - Do not unnecessarily persist sensitive raw input

10. **Narrative-level `StoryDocument` only**
    - Acts / scenes / structural beats, dramatic function, media **roles** (not clip IDs as editorial truth), VO/dialogue outlines, duration **targets**
    - `targetDurationMs` is optional on **acts only** (per the locked tree) and is a **narrative/structural target only** — it must **NEVER** become editorial timing (`startMs` / `endMs`)
    - No document-level editorial timing fields

11. **Minimal authenticated UI (Story section only)**
    - User-visible language: “Your story” / Build–Rebuild / status / readable outline
    - Hide plan / job / provider vocabulary from the product UX
    - No timeline editor, Director chat, rendering, or Generate Film

12. **Owner-only APIs**
    - `POST` compose (enqueue)
    - `GET` job status
    - `GET` latest / `?all=1` versions
    - Availability honesty (capability gateway pattern)

13. **Tests (minimum)**
    - Enqueue ≠ persist
    - Requires READY CreativePlan
    - Versioning + recompose continuity
    - Provenance / privacy
    - Local adapter ≠ production availability
    - Reject timing / clip-list payloads
    - Ownership checks
    - **Zero** Timeline / Render / FinishedMovie / Publication writes
    - StoryStructure status enum only `DRAFT` | `READY` | `SUPERSEDED` | `FAILED` (no in-progress on rows)

---

## 3. Must not include

M1 **MUST NOT** introduce:

- `startMs` / `endMs`
- Clip lists / `TimelineClip` semantics
- Tracks / transitions
- Render instructions / codec information / FFmpeg graphs
- `GeneratedAsset` IDs as editorial truth
- Provider-specific payloads in core/domain persistence
- VLC / libVLC
- `FinishedMovie`
- `Publication`
- Billing / payments
- Chat-as-memory / Director chat
- NLE behavior (drag, reorder-as-edit, timeline editing)
- Timeline / RenderJob schema work or writes
- Salvage of obsolete FilmBlueprint-via-StoryStructure from the historical workspace
- Generate Film
- Evaluation scoring
- Advertising / sponsorship influencing creative decisions
- Mobile
- Worker infrastructure extraction
- Object-storage migration
- Provider-specific architecture
- Generic AI memory
- Document-level editorial timing fields
- Job-type alias `STORY_COMPOSE` (use **`AI_STORY` only**)

**Do not** expand `CreativePlan` schema with story / timeline / render fields.  
**Do not** change `AiDirectorPort` return type or the Phase 2F CreativePlan lock.  
**Do not** modify `Timeline`, `TimelineClip`, `RenderJob`, `FinishedMovie`, or `Publication` schemas as part of M1.  
**Do not** change `composeStory` return into a provenance wrapper without a new lock amendment (attribution stays outside the port).

DB scope: harden **StoryStructure only**.

---

## 4. Contracts

**Consume (already authoritative from Phase 2F @ `29eef55`):**

- READY versioned `CreativePlan` as the sole creative-plan input to story composition
- Existing project / auth / job infrastructure patterns from 2F
- Provider-neutrality and attribution-outside-port patterns
- Phase 2A–2E artifacts only as inputs already reflected in CreativePlan / project context — M1 must not invent a parallel provider-specific understanding path

**`StoryComposerInput` (M1) must include:**

- The source READY CreativePlan (owned JSON)
- Privacy-minimized media inventory summary
- Project intent / effective brief (existing 2D/2E patterns)
- Optional previous READY StoryDocument for recompose continuity

**`StoryComposerInput` must not include:**

- Credentials
- Sponsor records
- Raw storage keys
- User email / identity
- Timeline / Render artifacts

**Add in M1 (thin, in service of the must-include list):**

| Contract | Role |
| --- | --- |
| **`StoryComposerPort.composeStory(input: StoryComposerInput) → StoryDocument`** | Provider-neutral story composition boundary |
| **`StoryComposerInput`** | Locked consume contract above |
| **`StoryDocument` schema v1** | Owned Zod (or equivalent) validation — field tree locked below |
| **`StoryService`** | Assemble input; compose via port; validate; persist; attribution |
| **`StoryWorker` + job type `AI_STORY`** | Off-HTTP composition; persist validated document |
| **Story capability gateway** | Availability honesty; require genuine configured adapter for production |

**Do not redefine** `AiDirectorPort`, Storage, Analysis, Renderer, or Playback ports in this milestone.  
**Do not amend** `AiDirectorPort`.

**Architectural rule:** a deterministic/local adapter may exist for testing and development. It must never be represented as real production AI merely to make story composition appear available. Production story capability is available only when a genuine configured adapter exists behind `StoryComposerPort`.

### StoryDocument schema v1 (field lock)

```
StoryDocument
├── schemaVersion
├── title?
├── logline?
├── spine
│   ├── opening
│   ├── development
│   └── resolution
├── acts[]
│   ├── id
│   ├── order
│   ├── title?
│   ├── purpose
│   ├── targetDurationMs?          # optional on acts only; narrative/structural TARGET — NEVER editorial timing
│   └── scenes[]
│       ├── id
│       ├── order
│       ├── title?
│       ├── purpose
│       ├── dramaticFunction
│       ├── mood?
│       ├── pacing?
│       ├── mediaRoles[]           # roles, not clip IDs as editorial truth
│       ├── voiceOverOutline?
│       ├── dialogueOutline?
│       └── notes?
├── source
│   ├── creativePlanId
│   ├── creativePlanVersion
│   └── planFingerprint?
└── rationale?
```

**Semantics locks:**

- `mediaRoles[]` describe **roles** media must play — not Timeline clip IDs, not cut lists.
- **`targetDurationMs` is optional on acts only (per the locked tree). No document-level editorial timing fields.**
- `targetDurationMs` must **never** become `startMs` / `endMs` or cut timing.
- Reject payloads that attempt to smuggle timing, clip lists, tracks, transitions, render, or provider host JSON into `StoryDocument`.

Exact TypeScript/Zod shaping, enums for `dramaticFunction`, and `mediaRoles` item schema are part of Engineer implementation **within** this conceptual lock and remain subject to Architect review at the implementation gate — they must not expand beyond narrative structure.

---

## 5. Database / provenance

`StoryStructure` is a first-class persisted artifact. It is **not** dumped into `CreativePlan`, and `CreativePlan` is **not** expanded to hold story fields.

Required fields / qualities:

- Project linkage
- Versioning (preserve previous versions; do not overwrite)
- **`status`:** `DRAFT` | `READY` | `SUPERSEDED` | `FAILED` (in-progress is Job-only)
- Validated YouFlicks-owned StoryDocument JSON (narrative-level only)
- Timestamps
- Job linkage

Required provenance (mirror 2F attribution pattern):

- `creativePlanId`
- `creativePlanVersion` (**exactly one READY CreativePlan version**)
- `jobId`
- Input fingerprint/hash (of assembled story input)
- `providerKey`
- `capability`

`modelId` / `modelVersion` / `planFingerprint` may be optional. They must not become provider-specific architectural requirements.

**Locked provenance rule:** each StoryStructure version derives from exactly one READY CreativePlan version; no silent plan-relationship mutation; prior versions preserved.

Do not add provider-specific architecture, vendor enums, or a generic AI memory table.

Do not change `Timeline`, `TimelineClip`, `RenderJob`, `FinishedMovie`, or `Publication` schemas in M1.

---

## 6. Services

| Piece | Role in M1 |
| --- | --- |
| **`StoryComposerPort`** | `composeStory(StoryComposerInput) → StoryDocument`; replaceable adapters |
| **`StoryService`** | Assemble `StoryComposerInput`; request composition through `StoryComposerPort`; validate; persist; record attribution |
| **`StoryWorker` + `AI_STORY`** | Perform story composition off the HTTP request; persist validated document; record `jobId` and other required provenance |
| **`StoryComposerPort` adapters** | Replaceable implementations. Test/local deterministic adapter allowed only for tests/development/contract verification. Genuine configured adapter required for production story availability. |
| Existing Director / CreativePlan | **Inputs only** (READY plan). Do not extend `AiDirectorPort`. |
| **Job status** | Carries in-progress (`PENDING` | `RUNNING` | …). **StoryStructure.status** remains `DRAFT` \| `READY` \| `SUPERSEDED` \| `FAILED` only. |

Sponsorship must not influence creative decisions. Credits/billing paths are not part of M1.

`renderer()` / playback / timeline services stay unimplemented / untouched in M1.

---

## 7. APIs / UI

**Minimal authenticated surface (owner-only):**

- Request / compose / rebuild — HTTP enqueues `AI_STORY`; does not run composition inline
- Status — job status for in-progress; StoryStructure status for persisted versions
- View story — latest and version history (`?all=1`)
- Availability honesty

**User-visible copy:** “Your story”, Build / Rebuild, status, readable outline.  
**Hide:** CreativePlan / job / provider / worker vocabulary.

**Must not appear:**

- Timeline editor / scene drag-reorder-as-NLE
- Director chat
- Rendering, download movie, or Generate Film
- Playback surfaces that pull VLC into this milestone

---

## 8. Acceptance criteria

M1 is complete only when all of the following are true. A local/deterministic adapter used only in tests or development does **not** satisfy production availability.

- [ ] First-class `StoryStructure` persistence exists: project-linked, versioned, statused (`DRAFT` \| `READY` \| `SUPERSEDED` \| `FAILED`), validated YouFlicks-owned StoryDocument JSON, timestamps, job linkage; previous versions preserved
- [ ] In-progress is represented on Job status only — not on StoryStructure rows
- [ ] Every version derives from exactly one READY `CreativePlan` version; rebuild never silently mutates that relationship on prior versions
- [ ] Required provenance persisted: `creativePlanId`, `creativePlanVersion`, `jobId`, input fingerprint/hash, `providerKey`, `capability`
- [ ] Optional `modelId` / `modelVersion` / `planFingerprint` are not treated as provider-specific architecture
- [ ] `StoryComposerInput` includes READY CreativePlan JSON, privacy-minimized media inventory summary, project intent/effective brief, and optional prior READY StoryDocument; excludes credentials, sponsor records, raw storage keys, user email/identity, Timeline/Render artifacts
- [ ] Recompose continuity uses prior READY StoryDocument (or defined narrative subset); no chat system; no Timeline reads
- [ ] `StoryService` assembles input, composes through `StoryComposerPort`, validates, persists, and records attribution
- [ ] `StoryComposerPort.composeStory` is the composition boundary; `AiDirectorPort` is unchanged and not overloaded; port return is `StoryDocument` (not a provenance wrapper)
- [ ] HTTP only enqueues **`AI_STORY`** (202); composition runs on the job/worker path
- [ ] Domain logic has no provider names; no provider-specific JSON is persisted as architectural truth; adapters remain replaceable
- [ ] Test/local deterministic adapter (if present) is not represented as production AI and does not mark production story available
- [ ] Production story is available only when a genuine configured adapter exists behind `StoryComposerPort`
- [ ] Missing capability → typed error; no fake creative fallback
- [ ] Persisted StoryDocument matches schema v1 field lock; `targetDurationMs` optional on acts only; no document-level editorial timing; rejects timing/clip-list/track/transition/render/provider-host smuggling
- [ ] `targetDurationMs` is never treated as editorial `startMs` / `endMs`
- [ ] Minimal authenticated Story UI: compose/rebuild, status, view outline — no timeline editor, Director chat, or rendering
- [ ] No writes to or schema changes for `Timeline`, `TimelineClip`, `RenderJob`, `FinishedMovie`, or `Publication`
- [ ] No `CreativePlan` schema expansion with story/timeline/render fields
- [ ] Tests cover: enqueue≠persist; READY plan required; versioning; recompose continuity; provenance/privacy; local≠production; ownership; zero Timeline/Render writes; StoryStructure status enum
- [ ] No salvage from obsolete historical 2G–2I / FilmBlueprint-via-StoryStructure workspace
- [ ] No Generate Film, evaluation scoring, advertising, sponsorship-influenced creative decisions, billing/payments, mobile, worker extraction, object-storage migration, provider-specific architecture, or generic AI memory

---

## 9. Dependencies

| Dependency | Why M1 depends on it |
| --- | --- |
| **Phase 2F @ `29eef55`** | READY versioned `CreativePlan` is the required input; Director / `AiDirectorPort` remain the plan boundary |
| **`PHASE_2F_ROADMAP_DECISION.md` @ `3e11c41`** | Architectural lock for CreativePlan; do not mutate |
| **2A** | Media inventory already reflected in upstream creative context (privacy-minimized summary into `StoryComposerInput`) |
| **2B–2C** | Normalized analysis already available upstream; M1 must not invent a parallel provider-specific understanding path |
| **2D** | Taste + intent / effective brief patterns for `StoryComposerInput` |
| **2E–2F** | Director contract executed; CreativePlan persisted |

M1 does **not** reopen Phase 2F implementation.

---

## 10. Relationship to M2+ (and locked roadmap numbering)

M1 prepares the architecture for:

**`CreativePlan` → `StoryStructure` → `Timeline` → assets → Render → Playback → FinishedMovie → Share/Export`**

M1 does **not** implement that full pipeline.

| Milestone | Name | Notes |
| --- | --- | --- |
| **M1** | Story from plan | CreativePlan → versioned StoryStructure (**this lock**) |
| **M2** | Cut from story | StoryStructure → executable Timeline (separate future lock) |
| **M3** | Generated / processed assets | Behind capability ports |
| **M4** | Render | RendererPort + RenderJob/manifest (provider-neutral) |
| **M5** | Playback | PlaybackPort (prefer VLC/libVLC where practical; **separate** from creative) |
| **M6** | FinishedMovie + Library | Keep the film |
| **M7** | Share / Export / Publication | Download/export + Publication foundation |
| **M8** | Product platform / operations | authZ, storage lifecycle, quotas, billing, observability, deploy — **must NOT own creative meaning**; may proceed in parallel when gated |

**Dependencies:** M1 → M2 → M3 → M4 → M5 → M6 → M7; M8 parallel/gated.

**Persistent vs derived (roadmap awareness — not M1 work):**  
Persistent: CreativePlan, StoryStructure, Timeline, MediaAsset, GeneratedAsset, FinishedMovie, Publication, RenderJob.  
Derived then snapshotted on job: RenderManifest.  
Runtime only: Playback.

Do **not** leak later-phase concepts backward into CreativePlan or into M1 StoryDocument.

---

## 11. Risks

1. **Collapsing plan → story** — treating StoryStructure as renamed CreativePlan. Mitigate: separate port, separate artifact, separate schema lock.
2. **Timings in StoryStructure** — `targetDurationMs` becoming editorial. Mitigate: acts-only optional target; hard reject `startMs`/`endMs`; tests for smuggled timing/clip lists.
3. **Vendor-shaped payloads** — provider JSON in domain. Mitigate: adapter-only providers; owned StoryDocument only.
4. **VLC / render / NLE leaking early** — Mitigate: hard exclusions list; UI Story section only.
5. **Salvaging obsolete 2G–2I / FilmBlueprint-via-StoryStructure** — Mitigate: public repo @ `29eef55` only; no cherry-picks from obsolete workspace.
6. **Treating a test/local adapter as production story** — Mitigate: production availability requires a genuine configured adapter behind `StoryComposerPort`.
7. **Billing / platform steering creative** — M8 must not own creative meaning.
8. **Long-running compose on HTTP** — Forbidden; enqueue `AI_STORY` only. Worker-process extraction is out of scope.
9. **Building chat for continuity** — Continuity is prior READY StoryDocument in `StoryComposerInput`, not a conversational UI.
10. **Confusing Job status with StoryStructure status** — Mitigate: in-progress on Job only; StoryStructure enum locked.

---

## 12. Implementation sequence

M1 is **not started**. When Architect unlocks Engineer, implement in this order and stop at the approved boundary:

1. Keep this approved specification as the lock; do not expand into M2+.
2. First-class `StoryStructure` persistence + required provenance + status enum; no Timeline/Render/FinishedMovie/Publication schema changes.
3. `StoryComposerPort` + `StoryComposerInput` + `StoryDocument` schema v1 validation.
4. `StoryService` + `AI_STORY` enqueue + worker path (`jobId`, input fingerprint/hash, no inline HTTP AI; attribution-outside-port).
5. Adapter boundary: replaceable `StoryComposerPort` implementations. Test/local deterministic adapter only for tests/development/contract verification — never as fake production availability.
6. Genuine configured adapter required before production story is available; missing capability → typed error.
7. Recompose: new version from exactly one READY CreativePlan; prior READY StoryDocument for continuity; preserve prior versions; never silently mutate historical plan relationships; no chat; no Timeline reads.
8. Minimal authenticated Story UI: compose/rebuild, status, view outline.
9. Automated verification per §8 → Architect implementation review → fix blockers → Architect approval → checkpoint commit (CoS-gated; clean staging; no review scratch/audit artifacts).

---

## 13. What M1 is

**M1 = Story from plan (CreativePlan → StoryStructure).**

It sits between:

- **Phase 2F** — Director execution & CreativePlan persistence (`29eef55`)
- **M2** — Cut from story (StoryStructure → Timeline) — **not this lock**

It does **not** mean generating films. It means the platform can turn a READY CreativePlan into a YouFlicks-owned, versioned narrative StoryStructure — and stop there.

**Architect APPROVED this lock (2026-09-08). Implementation remains CLOSED until CoS authorizes Engineer under this lock.** It is not implemented.

---

## Review & approval log

| Role | Action | Date | Result |
| --- | --- | --- | --- |
| Architect | Post-2F roadmap + M1 detailed specification | 2026-09-08 | Delivered (architecture proposal) |
| Brett | M1 gate decisions D1–D7 | 2026-09-08 | **APPROVED** |
| ChatGPT | Co-approval of M1 lock | — | Pending / not recorded — do not invent approval; Brett product-owner lock of D1–D7 stands |
| Architect | Preferred path/structure guidance | 2026-09-08 | `PHASE_M1_STORY_ROADMAP_DECISION.md`; mirror 2F numbered spine |
| Architect | Review of lock document | 2026-09-08 | **APPROVE WITH AMENDMENTS** (A1–A8) |
| Chief of Staff | Applied amendments A1–A8 | 2026-09-08 | Amended full text returned for final confirm |
| Architect | Final confirm of amended lock | 2026-09-08 | **APPROVED** |
| Chief of Staff | Implementation gate | — | **CLOSED** until CoS authorizes Engineer under this lock |
