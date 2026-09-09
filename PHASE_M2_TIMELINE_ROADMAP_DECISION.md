# Phase M2 Roadmap Decision Document — Cut from Story (Executable Timeline)

**Status:** Approved specification — not implemented  
**Milestone name:** M2 — Cut from story (StoryStructure → executable Timeline)  
**Basis:** Brett M2 architecture gate authorization (2026-09-09); Brett R1/R2 lock (2026-09-09); Architect post-2F roadmap; M1 CLOSED at checkpoint `82963c24f6c2adcf0e04314b98aeec2d79dca5bf`; binding locks `PHASE_2F_ROADMAP_DECISION.md` and `PHASE_M1_STORY_ROADMAP_DECISION.md`; Brett hard constraints for M2 (2026-09-09)  
**This document:** Authoritative specification for a **future** M2 implementation. M2 is **not started in code**. Do not treat this file as evidence that Timeline population exists. **Architect APPROVED this lock (2026-09-09). Implementation remains CLOSED until CoS authorizes Engineer under this lock.**

**Filename (locked):** `PHASE_M2_TIMELINE_ROADMAP_DECISION.md` at repository root, beside `PHASE_2F_ROADMAP_DECISION.md` and `PHASE_M1_STORY_ROADMAP_DECISION.md`.  
**Do not** overwrite or mutate `PHASE_2F_ROADMAP_DECISION.md` or `PHASE_M1_STORY_ROADMAP_DECISION.md`.

Authoritative Git repository: clean public `github.com/brettducross/Youflicks`.  
**Do not** merge, cherry-pick, or reuse the obsolete historical Cursor workspace (old 2F/2G/2H/2I, including FilmBlueprint-via-StoryStructure salvage).  
Treat `82963c2` as the authoritative implementation checkpoint for M2 design.

Roadmap placement (locked M1–M8): **M2 = Cut from story / executable Timeline** after M1 StoryStructure and before M3 Generated/processed assets.

---

## 0. Locked decisions (Brett — 2026-09-09)

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | CreativePlan | Phase 2F CreativePlan remains **immutable / versioned meaning**. M2 must not expand or rewrite CreativePlan. |
| D2 | StoryStructure | M1 StoryStructure remains **immutable / versioned narrative structure**. M2 must not expand StoryDocument into a timeline. |
| D3 | Provenance | Every Timeline version derives from **exactly one READY StoryStructure version**. Prior Timeline versions preserved. Rebuild must **never** silently mutate the source StoryStructure relationship. |
| D4 | Timeline identity | Timeline is an **executable editorial artifact** — **not** a second StoryStructure, **not** a professional NLE. |
| D5 | Hard M2 boundary | Do **not** introduce rendering, GeneratedAsset, playback/VLC, FinishedMovie, sharing/export, billing, sponsorship, or other M3+ functionality. |
| D6 | Provider neutrality | Preserve provider-neutral ports/adapters; no vendor enums or vendor JSON as domain truth. |
| D7 | Escalation | If a genuinely new product/architectural principle is required beyond this lock, **STOP** and escalate to CoS/Brett — do not invent the decision. |
| D8 / R1 | M2 UI | **Review-only** cut: Build / Rebuild, status, read-only shot list / simple times. **No** drag-reorder, trim handles, multi-track NLE, or freeform edit. (Closes M1 D3 for M2 as review-only.) |
| D9 / R2 | Unplaced media roles | M2 places **only existing `MediaAsset` rows**. Unmet story `mediaRoles` are recorded as **`unmetMediaRoles`** on TimelineDocument for M3. **No** GeneratedAsset IDs, no placeholder/fake assets, no null-asset “slots” treated as media. |
| D10 / R3 | Job type name | **`AI_TIMELINE`** only (parallel to `AI_DIRECT` / `AI_STORY`). Ban aliases. |
| D11 / R4 | Port name | **`TimelineComposerPort.composeTimeline(input) → TimelineDocument`**. Do **not** overload `StoryComposerPort` or `AiDirectorPort`. Attribution outside port return. |

---

## 1. Objective

Turn a READY, versioned YouFlicks-owned `StoryStructure` / `StoryDocument` into a validated, versioned YouFlicks-owned **executable Timeline** (header + clips), **and nothing beyond that**.

Pipeline position:

**Phase 2F CreativePlan → M1 StoryStructure → (M2) Timeline → M3 assets → M4 Render → …**

This is **not** generating missing media, rendering a movie, playback, library, share/export, or product-platform work.

**Architectural rule:** Timeline ≠ renamed StoryStructure. StoryStructure owns narrative structure (acts/scenes/roles/targets). Timeline owns **editorial execution**: ordered clips on simple tracks with **absolute timings** (`startMs` / `endMs`), source in/out on media, and light transitions/captions — enough to drive a later render, not enough to be Premiere/FCP.

---

## 2. Must include

1. **First-class versioned `Timeline` persistence**
   - Project-linked
   - Versioned (preserve previous versions; do not overwrite)
   - **`Timeline.status`:** `DRAFT` | `READY` | `SUPERSEDED` | `FAILED`
   - **In-progress belongs on the Job** (`PENDING` | `RUNNING` | …), not on Timeline rows
   - Required link to exactly one READY StoryStructure (`storyStructureId` + `storyStructureVersion`)
   - Validated YouFlicks-owned `TimelineDocument` JSON in `payload`
   - Executable `TimelineClip` rows written in the **same transaction** as the READY Timeline (projection of the document’s clips)
   - Provenance (§5)
   - Job linkage, timestamps
   - On rebuild: new version; prior READY → `SUPERSEDED`; never mutate historical StoryStructure relationship on prior rows

2. **`TimelineComposerPort` (provider-neutral)**
   - Locked shape: `composeTimeline(input: TimelineComposerInput) → TimelineDocument`
   - Do **not** overload `AiDirectorPort` or `StoryComposerPort`
   - Mirror 2F/M1 **attribution-outside-port** pattern
   - No provider names in domain logic; no provider-specific JSON as architectural truth
   - Adapters remain replaceable

3. **Test/local deterministic adapter (allowed, limited)**
   - Tests/dev/contract only
   - Must not masquerade as production AI
   - Must not falsely mark production timeline composition available

4. **Honest production capability**
   - Available only when a genuine configured adapter exists behind `TimelineComposerPort`
   - Missing capability → typed error; no fake editorial fallback

5. **`TimelineService` + `TimelineWorker`**
   - Require READY StoryStructure
   - Assemble `TimelineComposerInput`
   - Compose via port; validate `TimelineDocument`
   - Persist Timeline + TimelineClip rows; record attribution

6. **Asynchronous job path**
   - **Job type: `AI_TIMELINE`**
   - HTTP enqueues → **202**
   - Composition on worker path — no long-running AI inside HTTP

7. **Provenance continuity (locked)**
   - Every Timeline version derives from exactly one READY StoryStructure version
   - Previous Timeline versions preserved
   - Rebuild never silently mutates source StoryStructure relationship on prior versions

8. **Rebuild continuity**
   - When a prior READY Timeline exists, may pass a defined continuity subset into input (clip order / prior choices) — **not** a chat system
   - Must still bind to the **current** READY StoryStructure (if story rebuilt, timeline rebuild binds to new story version)

9. **Reproducibility**
   - Persist `jobId`, input fingerprint/hash, `storyStructureId`, `storyStructureVersion`
   - Optional: `creativePlanId` / `creativePlanVersion` copied from StoryStructure provenance for audit convenience (not a second source of truth)
   - Do not unnecessarily persist sensitive raw input

10. **Executable editorial semantics only where allowed**
    - Timing (`startMs` / `endMs`, source in/out) **belongs on Timeline / TimelineClip**
    - Must **not** write timings back into CreativePlan or StoryStructure

11. **Minimal authenticated UI (Cut / Timeline review only)**
    - User-visible: “Your cut” / Build–Rebuild / status / read-only ordered shot list with simple times
    - Hide job/provider/port vocabulary
    - **No** NLE, no render, no Generate Film, no VLC playback surface in M2

12. **Owner-only APIs**
    - `POST` compose (enqueue)
    - `GET` job status
    - `GET` latest / `?all=1` versions
    - Availability honesty

13. **Tests (minimum)**
    - Enqueue ≠ persist
    - Requires READY StoryStructure
    - Versioning + provenance; historical story link immutable on SUPERSEDED rows
    - Rebuild continuity without chat
    - Local ≠ production
    - Reject StoryDocument-shaped or render/VLC/GeneratedAsset smuggling
    - Ownership checks
    - **Zero** RenderJob / FinishedMovie / Publication / GeneratedAsset writes
    - **Zero** CreativePlan / StoryStructure schema expansion or narrative payload mutation
    - Timeline status enum only `DRAFT` | `READY` | `SUPERSEDED` | `FAILED`

---

## 3. Must not include (hard M2 boundary)

M2 **MUST NOT** introduce:

- Professional NLE behavior (multi-track freeform editing UI, magnetic timeline, nested sequences, keyframes, effects graphs)
- Rendering / FFmpeg graphs / codecs as domain truth / RenderJob execution
- GeneratedAsset creation or IDs as editorial truth (M3)
- Playback / VLC / libVLC (M5)
- FinishedMovie / Publication / share / export (M6–M7)
- Billing / payments / sponsorship influencing the cut
- Director chat / chat-as-memory
- Expanding CreativePlan or StoryDocument with clip lists or absolute timings
- Mutating PHASE_2F or PHASE_M1 lock files
- Salvage of obsolete 2G–2I / FilmBlueprint trees
- Worker infrastructure extraction / object-storage migration
- Provider-specific architecture / vendor enums / generic AI memory
- Job-type aliases other than **`AI_TIMELINE`**

DB scope: harden **Timeline** + **TimelineClip** only (plus Job type comment). No RenderJob / FinishedMovie / Publication schema work beyond existing stubs remaining unused.

---

## 4. Contracts

**Consume (authoritative):**

- READY versioned `StoryStructure` / `StoryDocument` (M1 @ `82963c2`)
- Project media inventory (`MediaAsset` + analysis status) — privacy-minimized
- Existing auth / job patterns from 2F/M1
- Provider neutrality + attribution-outside-port

**`TimelineComposerInput` (M2) must include:**

- Source READY StoryDocument (+ `storyStructureId`, `storyStructureVersion`)
- Privacy-minimized media inventory (asset ids, kind, durationMs, basic analysis summary — **no** storage keys, credentials, email)
- Optional prior READY TimelineDocument (or defined continuity subset) for rebuild
- Optional project intent / duration hints already present upstream (do not re-open CreativePlan mutation)

**`TimelineComposerInput` must not include:**

- Credentials, sponsor records, raw storage keys, user email/identity
- Render manifests, playback config, GeneratedAsset records
- Vendor host JSON

**Add in M2:**

| Contract | Role |
| --- | --- |
| **`TimelineComposerPort.composeTimeline(input) → TimelineDocument`** | Provider-neutral cut composition |
| **`TimelineComposerInput`** | Locked consume contract above |
| **`TimelineDocument` schema v1** | Owned validation — field tree below |
| **`TimelineService`** | Assemble; compose; validate; persist Timeline + clips; attribution |
| **`TimelineWorker` + `AI_TIMELINE`** | Off-HTTP composition |
| **Timeline capability gateway** | Production vs local honesty |

**Do not redefine** AiDirectorPort, StoryComposerPort, Storage, Analysis, Renderer, or Playback ports.

### TimelineDocument schema v1 (field lock)

```
TimelineDocument
├── schemaVersion                 # "1.0"
├── title?
├── totalDurationMs               # derived/declared total cut length
├── tracks[]                      # fixed YouFlicks track kinds only (see semantics)
│   ├── trackKey                  # e.g. video.primary | audio.voice | audio.music | caption.main
│   ├── kind                      # VIDEO | AUDIO | CAPTION
│   └── label?
├── clips[]
│   ├── id
│   ├── trackKey                  # must reference tracks[].trackKey
│   ├── order                     # order within track
│   ├── assetId                   # required MediaAsset id for every placed clip (D9/R2)
│   ├── storySceneId?             # optional link back to StoryDocument scene id
│   ├── mediaRole?                # role this clip fulfills
│   ├── timelineStartMs           # absolute position on timeline (>= 0)
│   ├── timelineEndMs             # absolute end (> start)
│   ├── sourceInMs?               # in-point on source asset
│   ├── sourceOutMs?              # out-point on source asset
│   ├── transitionFromPrevious?   # CUT | DISSOLVE | FADE — light only
│   ├── captionText?              # only when track kind is CAPTION
│   └── notes?
├── unmetMediaRoles[]?            # explicit gaps for M3 (role, storySceneId?, reason)
├── source
│   ├── storyStructureId
│   ├── storyStructureVersion
│   └── storyFingerprint?
└── rationale?
```

**Semantics locks:**

- **Timing is legal here** (`timelineStartMs` / `timelineEndMs`, source in/out). It is **illegal** on CreativePlan / StoryDocument.
- Track set is a **small fixed vocabulary** (YouFlicks cut), not arbitrary NLE tracks. Exact enum values finalized in Zod at implementation gate within this tree.
- `transitionFromPrevious` is a **light enum only** — not effect graphs.
- `assetId` is **required** on every placed clip and references **`MediaAsset` only** (D9/R2 locked).
- `unmetMediaRoles` records honest gaps for M3 — **not** fake media, **not** GeneratedAsset IDs, **not** placeholder clips with null `assetId`.
- Reject smuggling of render specs, FFmpeg, VLC, GeneratedAsset, sponsor, or provider-host JSON.

**Prisma projection (same transaction on READY persist):**

- `Timeline` header + provenance + `payload` = validated TimelineDocument
- `TimelineClip` rows: one per placed clip (`assetId`, `sortOrder`, `startMs`←timelineStartMs, `endMs`←timelineEndMs, `payload` for trackKey/source in-out/transition/caption/notes)
- Do not leave READY Timeline without matching clip rows for placed clips

---

## 5. Database / provenance

Harden existing `Timeline` / `TimelineClip` stubs (Phase 1) — do not invent a parallel table.

**Timeline required qualities:**

- `projectId`, `version` (unique per project), status enum above
- `storyStructureId` **required** (change from optional) + `storyStructureVersion` Int required
- `payload` validated TimelineDocument
- `jobId`, `inputFingerprint`, `providerKey`, `capability`
- optional `modelId` / `modelVersion` / `storyFingerprint`
- optional convenience copies: `creativePlanId`, `creativePlanVersion` from StoryStructure provenance
- timestamps; indexes on `(projectId, createdAt)`, `jobId`

**TimelineClip:**

- Retain relational clips; ensure `startMs`/`endMs` mean **timeline absolute range**
- Store source in/out and trackKey in clip `payload` (or dedicated columns if Engineer prefers within Architect review) — must remain YouFlicks-owned, not vendor JSON
- `assetId` **must not be null** on TimelineClip rows for placed clips (D9/R2); unmet roles live only in `unmetMediaRoles`, not as clip rows

**Locked provenance rule:** each Timeline version ↔ exactly one READY StoryStructure version; no silent mutation; prior versions preserved.

Do not change CreativePlan, StoryStructure narrative schema, RenderJob, FinishedMovie, or Publication beyond leaving stubs unused.

---

## 6. Services

| Piece | Role in M2 |
| --- | --- |
| **`TimelineComposerPort`** | `composeTimeline` → `TimelineDocument` |
| **`TimelineService`** | Require READY story; assemble; compose; validate; persist; attribution |
| **`TimelineWorker` + `AI_TIMELINE`** | Off-HTTP composition |
| **Adapters** | HTTP production + local deterministic test/dev |
| Story / CreativePlan | **Inputs only** |

`renderer()` / playback remain unimplemented.

---

## 7. APIs / UI

**Owner-only:**

- Compose / rebuild → enqueue `AI_TIMELINE` → 202
- Job status
- View latest cut / version history (`?all=1`)
- Availability honesty

**User-visible:** “Your cut”, Build / Rebuild, status, read-only ordered shot list with simple times.  
**Hide:** ports, jobs, providers, StoryStructure/CreativePlan jargon where product copy can say “story” / “direction”.

**Must not appear:** NLE editor, Generate Film, render download, VLC player, asset generator UI.

---

## 8. Acceptance criteria

M2 is complete only when all are true. Local/deterministic adapter does **not** satisfy production availability.

- [ ] Versioned Timeline persistence with status `DRAFT` | `READY` | `SUPERSEDED` | `FAILED`; in-progress on Job only
- [ ] Every version derives from exactly one READY StoryStructure; historical link immutable on prior versions
- [ ] Required provenance: storyStructureId/version, jobId, input fingerprint, providerKey, capability
- [ ] `TimelineComposerPort.composeTimeline` is the boundary; AiDirectorPort and StoryComposerPort unchanged
- [ ] HTTP enqueues **`AI_TIMELINE`** (202); worker composes
- [ ] TimelineDocument v1 validated; timings only on timeline/clips; unmet roles only via `unmetMediaRoles` (D9/R2); every placed clip has MediaAsset `assetId`
- [ ] TimelineClip rows match placed clips in same transaction
- [ ] Local ≠ production availability; missing adapter → typed error
- [ ] Review-only UI only (D8/R1): Build/Rebuild, status, read-only shot list / simple times — no drag-reorder, trim, multi-track NLE, freeform edit, render, VLC, or Generate Film
- [ ] Zero RenderJob / FinishedMovie / Publication / GeneratedAsset writes
- [ ] Zero CreativePlan / StoryStructure schema expansion; no timing written into StoryDocument
- [ ] PHASE_2F and PHASE_M1 lock files untouched
- [ ] No obsolete 2G–2I salvage
- [ ] Tests cover enqueue≠persist, READY story required, versioning/provenance, rebuild continuity, privacy, ownership, smuggle rejection, zero M3+ writes

---

## 9. Dependencies

| Dependency | Why |
| --- | --- |
| **M1 @ `82963c2`** | READY StoryStructure is required input |
| **`PHASE_M1_STORY_ROADMAP_DECISION.md`** | Narrative boundary; timings forbidden upstream |
| **Phase 2F CreativePlan** | Upstream meaning; not mutated |
| **2A MediaAsset** | Clip `assetId` targets |
| **2B–2C analysis** | Optional ranking hints only via minimized inventory |

---

## 10. Relationship to M3+

M2 prepares: **`Timeline → (M3 fill gaps) → Render → Playback → FinishedMovie`**.

M2 does **not** implement M3–M8. GeneratedAsset, RendererPort execution, VLC, FinishedMovie promotion remain later locks.

---

## 11. Risks

1. Building a pro NLE — mitigate: review-only UI (D8/R1 locked); fixed track vocabulary; light transitions only.  
2. Writing timings back into StoryStructure — mitigate: validators + tests.  
3. Fake media / GeneratedAsset leakage — mitigate: D9/R2 locked + hard exclusions.  
4. Treating local adapter as production — mitigate: capability gating.  
5. Optional `storyStructureId` left nullable — mitigate: M2 requires NOT NULL.  
6. Dual source of truth payload vs TimelineClip — mitigate: same-transaction write; document is validated source; clips are projection.  
7. Salvaging obsolete timeline/render stacks — forbid.

---

## 12. Implementation sequence (when unlocked)

1. Keep this lock; do not expand into M3+.  
2. Harden Timeline / TimelineClip + provenance; require storyStructureId/version.  
3. TimelineDocument schema v1 + TimelineComposerPort + input/privacy.  
4. TimelineService + AI_TIMELINE worker (202 enqueue).  
5. Adapters: local test/dev; HTTP production gating.  
6. Owner APIs + review-only UI (D8/R1).  
7. §8 tests → Architect implementation review → checkpoint.

---

## 13. What M2 is

**M2 = Cut from story (StoryStructure → executable Timeline).**

It sits between:

- **M1** — Story from plan (`82963c2`)
- **M3** — Generated / processed assets — **not this lock**

It means YouFlicks can turn a READY story into a versioned, executable cut referencing the owner’s media — and stop before generating missing assets or rendering a film.

**Architect APPROVED this lock (2026-09-09).** Implementation remains CLOSED until CoS authorizes Engineer under this lock. It is not implemented.

---

## Open questions

None remaining for M2 lock. R1/R2 locked by Brett 2026-09-09. Further product questions defer to M3+.

---

## Review & approval log

| Role | Action | Date | Result |
| --- | --- | --- | --- |
| Brett | M2 architecture gate authorized | 2026-09-09 | **AUTHORIZED** (implementation CLOSED) |
| Architect | Draft `PHASE_M2_TIMELINE_ROADMAP_DECISION.md` | 2026-09-09 | **DRAFT delivered** |
| Brett | R1 review-only UI; R2 MediaAsset-only + unmetMediaRoles | 2026-09-09 | **LOCKED** (R3/R4 soft locks stand) |
| Architect | Encode R1–R4 as D8–D11; final lock review | 2026-09-09 | **APPROVED** |
| Chief of Staff | Engineer gate | — | **CLOSED** until CoS authorizes Engineer under this lock |
