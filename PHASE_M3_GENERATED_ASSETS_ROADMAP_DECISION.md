# Phase M3 Roadmap Decision Document — Generated & Processed Assets

**Status:** Approved specification — not implemented  
**Milestone name:** M3 — Generated & processed assets / Make missing pieces  
**Basis:** Brett M3 architecture gate authorization (2026-09-09); Brett R1–R3 lock (2026-09-09); Architect post-2F roadmap; M2 CLOSED at checkpoint `e70653e1c2d765aab1fb1d22890d37306cfd52b4`; binding locks `PHASE_2F_ROADMAP_DECISION.md`, `PHASE_M1_STORY_ROADMAP_DECISION.md`, `PHASE_M2_TIMELINE_ROADMAP_DECISION.md`; Brett hard constraints for M3 (2026-09-09)  
**This document:** Authoritative specification for a **future** M3 implementation. M3 is **not started in code**. Do not treat this file as evidence that GeneratedAsset population exists. **Architect APPROVED this lock (2026-09-09). Implementation remains CLOSED until CoS authorizes Engineer under this lock.**

**Filename (locked):** `PHASE_M3_GENERATED_ASSETS_ROADMAP_DECISION.md` at repository root, beside prior phase locks.  
**Do not** overwrite or mutate `PHASE_2F_ROADMAP_DECISION.md`, `PHASE_M1_STORY_ROADMAP_DECISION.md`, or `PHASE_M2_TIMELINE_ROADMAP_DECISION.md`.

Authoritative Git repository: clean public `github.com/brettducross/Youflicks`.  
**Do not** merge, cherry-pick, or reuse the obsolete historical Cursor workspace (old 2F/2G/2H/2I).  
Treat `e70653e` as the authoritative implementation checkpoint for M3 design.

Roadmap placement (locked M1–M8): **M3 = Generated / processed assets** after M2 Timeline and before M4 Render.

---

## 0. Locked decisions (Brett — 2026-09-09)

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | Phase 2F CreativePlan, M1 StoryStructure, and M2 Timeline **contracts remain binding**. M3 must not redefine meaning/narrative/cut schemas as provider-shaped. |
| D2 | GeneratedAsset identity | **`GeneratedAsset` is a first-class YouFlicks-owned artifact**, distinct from user-uploaded **`MediaAsset`**. |
| D3 | Provider neutrality | Permanent. No vendor-specific DB architecture; no vendor enums as domain truth; adapters only. |
| D4 | unmetMediaRoles | M2 TimelineDocument `unmetMediaRoles` becomes **actionable** in M3 **without** contaminating StoryStructure or Timeline with vendor/host JSON. |
| D5 | Hard M3 boundary | Do **not** introduce M4 Render execution, M5 Playback/VLC, M6 FinishedMovie promotion, M7 Share/Export, or M8 platform/billing ownership of creative meaning. |
| D6 | UI | Minimal review/status experience. **No NLE.** |
| D7 | Escalation | If a genuinely new product/architectural principle is required, **STOP** and escalate to CoS/Brett — do not invent the decision. |
| D8 / R1 | Timeline placement | Expand Timeline clip source identity to **`MEDIA_ASSET \| GENERATED_ASSET`** (discriminator + id). Rebuild cut (review-only) may place READY GeneratedAssets into Timeline vN+1. **Not** a StoryStructure change; **not** vendor data. |
| D9 / R2 | Rebuild trigger | Generation READY → user explicitly **Rebuild cut**. **No** silent Timeline rewrite on generation success. |
| D10 / R3 | Kind set (v1) | Locked kinds: **`IMAGE \| VOICE_OVER \| MUSIC \| SFX \| VIDEO_CLIP \| ENHANCEMENT`**. Schema must accept the full set; adapter coverage may be a subset with honest capability gating. |
| D11 / R4 | Job type | **`AI_ASSET`** only (batch fulfill unmet roles / requested generations). Ban aliases (`AI_GENERATE`, `ASSET_COMPOSE`, …). |
| D12 / R5 | Port | **`AssetGeneratorPort.generate(input) → GeneratedAssetDocument`** (one asset per call) + orchestration in `AssetService` for batches. Do not overload Director/Story/Timeline ports. Attribution outside port return. |

---

## 1. Objective

Turn **unmet media needs** (from a READY M2 Timeline’s `unmetMediaRoles`, plus optional explicit requests) into validated, versioned YouFlicks-owned **`GeneratedAsset`** records (bytes in StoragePort + metadata), **and** (D8/R1) support an explicit review-only **Rebuild cut** that may place READY GeneratedAssets into a new Timeline version.

Pipeline position:

**… → M2 Timeline (+ unmetMediaRoles) → (M3) GeneratedAsset → M4 Render → …**

This is **not** rendering a movie, playback, library, share/export, or product-platform work.

**Architectural rules:**

- **`MediaAsset`** = user-provided footage/media (ingest). Sacred as “your footage.”
- **`GeneratedAsset`** = YouFlicks-produced or processed media filling a creative/editorial gap.
- StoryStructure stays narrative-only. Timeline stays editorial — **gains a source discriminator** in M3 (D8/R1): `MEDIA_ASSET | GENERATED_ASSET`. Never vendor payloads.
- Provider adapters speak HTTP/SDK behind ports; domain persists YouFlicks-owned docs + opaque `storageKey`s only.

---

## 2. Must include

1. **First-class `GeneratedAsset` persistence**
   - Project-linked
   - Identity: stable `id`; optional versioning per logical asset lineage (`lineageId` + `version`) **or** immutable rows with SUPERSEDED siblings — Engineer picks one pattern **within** this lock (prefer: immutable rows; regenerate → new row; prior READY for same unmet-role key → `SUPERSEDED` when replaced)
   - **`GeneratedAsset.status`:** `DRAFT` | `READY` | `SUPERSEDED` | `FAILED`
   - **In-progress on Job only** (`PENDING` | `RUNNING` | …)
   - Kind (R3 set), mimeType, byteSize, duration/width/height when applicable
   - Opaque `storageKey` / optional `previewKey` via **StoragePort** (never vendor URLs)
   - YouFlicks-owned `GeneratedAssetDocument` / metadata JSON (schema v1)
   - Provenance (§5)
   - Job linkage, timestamps, checksum when available

2. **`AssetGeneratorPort` (provider-neutral)**
   - Locked shape: `generate(input: AssetGeneratorInput) → GeneratedAssetDocument`
   - Document describes **validated metadata + storage placement instructions completed by service** (bytes written through StoragePort by service/adapter boundary as designed — domain never stores raw vendor URLs)
   - Do **not** overload `AiDirectorPort`, `StoryComposerPort`, or `TimelineComposerPort`
   - Attribution-outside-port
   - Capability routing inside adapters/registry (e.g. `IMAGE_GENERATION`, `VOICE_SYNTHESIS`, `MUSIC_GENERATION`, `SFX_GENERATION`, `VIDEO_GENERATION`, `MEDIA_ENHANCEMENT`) — YouFlicks capability strings, not vendor enums

3. **Test/local deterministic adapter (allowed, limited)**
   - Tests/dev only; never production availability
   - May write tiny placeholder bytes to local StoragePort

4. **Honest production capability**
   - Per-capability availability honesty (a missing voice adapter must not fake voice)
   - Missing capability → typed error; no silent skip that marks READY

5. **`AssetService` + `AssetWorker`**
   - Require READY Timeline when fulfilling from `unmetMediaRoles`
   - Assemble `AssetGeneratorInput` (role, scene hints from StoryDocument **copy in input**, timeline ids/versions, privacy-minimized refs)
   - Call port; validate; persist GeneratedAsset; record attribution
   - Batch orchestration: one `AI_ASSET` job may fulfill N unmet roles sequentially with per-asset rows

6. **Asynchronous job path**
   - **Job type: `AI_ASSET`**
   - HTTP enqueue → **202**
   - Generation on worker path — no long-running AI on HTTP
   - Cancellation: Job `CANCELLED` stops further role attempts; already-READY assets remain
   - Retry: Job-level retry must not corrupt provenance; prefer new attempts updating FAILED → new row or same job attempt counter without rewriting READY siblings
   - Idempotency: same `inputFingerprint` + open RUNNING job must not double-enqueue duplicates (mirror 2F/M1 patterns)

7. **Driving from M2 `unmetMediaRoles`**
   - Read from latest READY TimelineDocument only
   - Map each unmet role → generation request
   - Persist fulfillment linkage on GeneratedAsset: `timelineId`, `timelineVersion`, `role`, optional `storySceneId`, `reason`
   - **Do not** write vendor fields into Timeline.payload or StoryStructure.payload
   - **Do not** delete or mutate historical Timeline rows’ story relationship

8. **Explicit Timeline rebuild (D8/R1 + D9/R2 locked)**
   - Explicit user action “Rebuild cut” after assets READY — **never** silent rewrite on generation success
   - New Timeline version may include clips with `sourceKind: GENERATED_ASSET` + `generatedAssetId`
   - Existing MediaAsset clips remain `sourceKind: MEDIA_ASSET`
   - unmetMediaRoles shrinks for roles now fulfilled
   - Still review-only UI — no NLE

9. **Reproducibility / provenance**
   - `jobId`, `inputFingerprint`
   - `providerKey`, `capability`, optional `modelId`/`modelVersion`
   - Source context: `timelineId`/`timelineVersion`, optional `storyStructureId`/`storyStructureVersion`, optional source `mediaAssetId` for ENHANCEMENT
   - No secrets, emails, storage credentials, sponsor records in generator input

10. **Validation**
    - Schema v1 for GeneratedAssetDocument
    - Reject vendor-host JSON as domain truth
    - READY requires successful StoragePort write + checksum/size sanity
    - Kind/mime consistency

11. **Minimal authenticated UI**
    - User-visible: “Missing pieces” / Generate / status / list of filled roles + simple previews when available
    - Hide ports/jobs/providers
    - **No** NLE, render, Generate Film, VLC player

12. **Owner-only APIs**
    - `POST` generate (enqueue from unmet roles and/or explicit selection)
    - `GET` job status
    - `GET` assets / latest fulfillments
    - Availability honesty (per capability)
    - `POST` timeline rebuild (“Rebuild cut”) after GeneratedAssets READY (D8/D9)

13. **Tests (minimum)**
    - Enqueue ≠ persist READY
    - Requires READY Timeline when fulfilling unmetMediaRoles
    - MediaAsset ≠ GeneratedAsset isolation
    - No vendor JSON in Story/Timeline payloads
    - Local ≠ production
    - Ownership / cross-user blocked
    - Zero RenderJob execution / FinishedMovie / Publication writes
    - Cancellation / failure semantics
    - TimelineClip source discriminator + explicit rebuild continuity (D8/D9)

---

## 3. Must not include (hard M3 boundary)

M3 **MUST NOT** introduce:

- RenderJob **execution**, FFmpeg graphs as domain truth, codec pipelines as product UI
- Playback / VLC / libVLC
- FinishedMovie promotion / library / share / export / Publication
- Billing / payments / sponsorship influencing generation
- NLE editing
- Mutating PHASE_2F / PHASE_M1 / PHASE_M2 lock files
- Collapsing GeneratedAsset into MediaAsset (user footage pollution)
- Writing vendor/host JSON into CreativePlan, StoryDocument, or TimelineDocument
- Salvage of obsolete 2G–2I trees
- Worker extraction / object-storage migration as M3 scope (use existing StoragePort)
- Job-type aliases other than **`AI_ASSET`**

DB scope: add **`GeneratedAsset`** (+ Project relation). TimelineClip / TimelineDocument clip shape **gains** source discriminator (D8). No FinishedMovie/Publication/RenderJob schema expansion beyond unused stubs.

---

## 4. Contracts

**Consume:**

- READY TimelineDocument (`unmetMediaRoles`, timeline id/version)
- Optional StoryDocument narrative subset for role/scene context (read-only)
- MediaAsset inventory for ENHANCEMENT source refs
- StoragePort, JobQueuePort, auth patterns from 2F/M1/M2

**`AssetGeneratorInput` must include:**

- `projectId`
- Target `kind` + `role` (+ optional `storySceneId`, human `reason`)
- Privacy-minimized creative hints (from story scene / brief — no taste raw dump required)
- Optional source `mediaAssetId` for ENHANCEMENT
- Provenance context ids (timeline/story versions)
- Optional prior GeneratedAsset metadata for regenerate continuity (**not** chat)

**Must not include:** credentials, sponsor records, raw storage keys, user email/identity, render manifests, playback config, vendor host JSON

**Add in M3:**

| Contract | Role |
| --- | --- |
| **`AssetGeneratorPort.generate` → `GeneratedAssetDocument`** | Provider-neutral generation/processing |
| **`AssetGeneratorInput`** | Locked consume contract |
| **`GeneratedAssetDocument` schema v1** | Owned validation |
| **`AssetService` + `AssetWorker` + `AI_ASSET`** | Orchestration / persistence |
| **Asset capability gateway** | Per-capability production vs local honesty |

### GeneratedAssetDocument schema v1 (field lock)

```
GeneratedAssetDocument
├── schemaVersion                 # "1.0"
├── kind                          # IMAGE | VOICE_OVER | MUSIC | SFX | VIDEO_CLIP | ENHANCEMENT
├── role                          # media role string fulfilled (from unmetMediaRoles.role)
├── title?
├── mimeType
├── durationMs?
├── width?
├── height?
├── checksum?
├── storageKey                    # opaque StoragePort key (service-assigned)
├── previewKey?
├── origin                        # GENERATED | PROCESSED
├── sourceMediaAssetId?           # required when origin=PROCESSED / kind=ENHANCEMENT
├── fulfillment
│   ├── timelineId
│   ├── timelineVersion
│   ├── storySceneId?
│   └── unmetReason?
├── source
│   ├── storyStructureId?
│   ├── storyStructureVersion?
│   └── briefFingerprint?
└── rationale?
```

**Semantics:**

- `storageKey` is YouFlicks StoragePort opaque — never a vendor CDN URL as truth
- `role` ties to M2 unmetMediaRoles without embedding vendor fields
- Reject smuggling of render/VLC/sponsor/provider-host JSON

### Timeline clip source extension (D8/R1 locked)

```
TimelineDocument.clips[] (M3+)
├── …existing M2 fields…
├── sourceKind                    # MEDIA_ASSET | GENERATED_ASSET
├── assetId?                      # when MEDIA_ASSET (M2 behavior)
└── generatedAssetId?             # when GENERATED_ASSET
```

Exactly one of `assetId` / `generatedAssetId` according to `sourceKind`. Prisma `TimelineClip` gains matching columns / constraints. Historical M2 rows remain `MEDIA_ASSET`.

---

## 5. Database / provenance

**New model `GeneratedAsset`:**

- `projectId`, status enum above
- kind, origin, role, mimeType, byteSize, storageKey, previewKey?, duration/width/height?, checksum?
- `payload` JSON = GeneratedAssetDocument (or metadata subset + document)
- `jobId`, `inputFingerprint`, `providerKey`, `capability`, model fields
- Fulfillment: `timelineId`, `timelineVersion`, `storySceneId?`
- Optional `sourceMediaAssetId`
- Optional lineage: `replacesAssetId` when SUPERSEDE regenerate
- Indexes: `(projectId, createdAt)`, `jobId`, `(timelineId, role)`

**Do not** add GeneratedAsset rows into `MediaAsset`.

**ProviderAttribution** may record capability invocations (extend optional `assetId` semantics or add `generatedAssetId` column — Engineer choice within Architect review; must remain provenance-only).

---

## 6. Services

| Piece | Role |
| --- | --- |
| **`AssetGeneratorPort`** | `generate` → document |
| **`AssetService`** | Assemble; batch unmet roles; validate; StoragePort; persist; attribution |
| **`AssetWorker` + `AI_ASSET`** | Off-HTTP |
| **Adapters** | HTTP production per capability; local deterministic test/dev |
| Timeline/Story/CreativePlan | **Inputs only** (plus explicit Rebuild cut path — D8/D9) |

`renderer()` / playback remain unimplemented.

---

## 7. APIs / UI

**Owner-only:**

- Generate missing pieces → enqueue `AI_ASSET` → 202
- Job status; list GeneratedAssets; availability by capability
- Rebuild cut → Timeline compose path with generated inventory available (D8/D9); **never** auto-fired on generation success

**User-visible:** “Missing pieces”, Generate, status, role filled / failed, simple preview.  
**Must not appear:** NLE, render download, VLC, billing, provider names as product chrome.

---

## 8. Acceptance criteria

- [ ] First-class GeneratedAsset persistence with status `DRAFT` \| `READY` \| `SUPERSEDED` \| `FAILED`; in-progress on Job only
- [ ] Distinct from MediaAsset; StoragePort opaque keys only
- [ ] `AssetGeneratorPort` boundary; Director/Story/Timeline compose ports not overloaded
- [ ] HTTP enqueues **`AI_ASSET`** (202); worker generates
- [ ] Fulfillment driven from READY Timeline `unmetMediaRoles` without vendor fields in Story/Timeline payloads
- [ ] Provenance: jobId, inputFingerprint, providerKey, capability, timeline/context ids
- [ ] Local ≠ production; per-capability honesty; typed errors
- [ ] Failure / retry / cancel semantics do not corrupt READY siblings
- [ ] Minimal review UI only — no NLE / render / VLC
- [ ] Zero RenderJob execution / FinishedMovie / Publication product paths
- [ ] PHASE_2F / PHASE_M1 / PHASE_M2 lock files untouched
- [ ] Timeline source discriminator (`MEDIA_ASSET | GENERATED_ASSET`) + explicit Rebuild cut path tests (D8/D9); no silent Timeline rewrite
- [ ] Tests cover ownership, privacy, idempotent enqueue, smuggle rejection

---

## 9. Dependencies

| Dependency | Why |
| --- | --- |
| **M2 @ `e70653e`** | READY Timeline + `unmetMediaRoles` |
| **M1 StoryStructure** | Optional narrative context for prompts |
| **StoragePort / JobQueue** | Bytes + async |
| **2A MediaAsset** | ENHANCEMENT source; contrast identity |

---

## 10. Relationship to M4+

M3 prepares media so M4 Render can consume a Timeline whose clips resolve to real bytes (user + generated). M3 does **not** implement render manifests, FinishedMovie, or playback.

---

## 11. Risks

1. Polluting MediaAsset with AI output — mitigate: separate model.  
2. Vendor JSON in Timeline/Story — mitigate: fulfillment on GeneratedAsset only; privacy walkers.  
3. Silent Timeline mutation — mitigate: D9/R2 explicit rebuild only.  
4. Fake production adapters — mitigate: capability gating.  
5. Scope creep into render/NLE — hard exclusions.  
6. Generating without a cut context — mitigate: require READY Timeline for unmet-role fulfillment.

---

## 12. Implementation sequence (when unlocked)

1. Keep this lock; no M4+.  
2. GeneratedAsset model + migration; StoragePort wiring.  
3. Schema v1 + AssetGeneratorPort + privacy/validation.  
4. AssetService + AI_ASSET worker (202).  
5. Adapters + capability gateway.  
6. APIs + review UI.  
7. Timeline source discriminator + explicit Rebuild cut path (D8/D9).  
8. §8 tests → Architect implementation review → checkpoint.

---

## 13. What M3 is

**M3 = Make missing pieces (Generated & processed assets).**

It sits between:

- **M2** — Cut from story (`e70653e`)
- **M4** — Render — **not this lock**

It means YouFlicks can create YouFlicks-owned media to fill unmet story/cut roles — without rendering a film or becoming an NLE.

**Architect APPROVED this lock (2026-09-09).** Implementation remains CLOSED until CoS authorizes Engineer under this lock. It is not implemented.

---

## Open questions

None remaining for M3 lock. R1–R3 locked by Brett 2026-09-09. Soft R4/R5 promoted to D11/D12. Further product questions defer to M4+.

---

## Review & approval log

| Role | Action | Date | Result |
| --- | --- | --- | --- |
| Brett | M3 architecture gate authorized | 2026-09-09 | **AUTHORIZED** (implementation CLOSED) |
| Architect | Draft `PHASE_M3_GENERATED_ASSETS_ROADMAP_DECISION.md` | 2026-09-09 | **DRAFT delivered** |
| Brett | R1 Timeline GENERATED_ASSET refs YES; R2 explicit Rebuild cut; R3 full kind set | 2026-09-09 | **LOCKED** (R4/R5 soft locks stand → D11/D12) |
| Architect | Encode R1–R5 as D8–D12; final lock review | 2026-09-09 | **APPROVED** |
| Chief of Staff | Engineer gate | — | **CLOSED** until CoS authorizes Engineer under this lock |
