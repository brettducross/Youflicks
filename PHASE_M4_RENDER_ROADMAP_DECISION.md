# Phase M4 Roadmap Decision Document — Render

**Status:** Approved specification — not implemented  
**Milestone name:** M4 — Render (Timeline → render output)  
**Basis:** CoS autonomous M4 architecture gate after M3 CLOSED (2026-09-09); M3 checkpoint `4a0cb50ae24e435cfcf39d3fccc75b3dfd4f7d48`; binding locks PHASE_2F / PHASE_M1 / PHASE_M2 / PHASE_M3; provider-neutrality permanent  
**This document:** Authoritative specification for a **future** M4 implementation. M4 is **not started in code**. Do not treat this file as evidence that rendering exists. **Architect APPROVED this lock (2026-09-09). Implementation remains CLOSED until CoS authorizes Engineer under this lock.**

**Filename (locked):** `PHASE_M4_RENDER_ROADMAP_DECISION.md` at repository root.  
**Do not** overwrite or mutate `PHASE_2F_ROADMAP_DECISION.md`, `PHASE_M1_STORY_ROADMAP_DECISION.md`, `PHASE_M2_TIMELINE_ROADMAP_DECISION.md`, or `PHASE_M3_GENERATED_ASSETS_ROADMAP_DECISION.md`.

Authoritative Git repository: clean public `github.com/brettducross/Youflicks`.  
**Do not** salvage obsolete historical Cursor workspace trees.  
Treat `4a0cb50` as the authoritative implementation checkpoint for M4 design.

Roadmap placement: **M4 = Render** after M3 GeneratedAsset and before M5 Playback.

---

## 0. Locked decisions

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | CreativePlan, StoryStructure, Timeline, and GeneratedAsset contracts remain binding. M4 consumes them; does not redefine them as provider-shaped. |
| D2 | M4 identity | M4 produces a **YouFlicks-owned render** (`RenderJob` + snapshotted `RenderManifest` + opaque output `storageKey`). It is **not** FinishedMovie promotion (M6), **not** Playback (M5), **not** an NLE. |
| D3 | Provider neutrality | Permanent. Adapters only. No vendor enums / vendor host JSON as domain truth. |
| D4 | Input | Every successful render derives from **exactly one READY Timeline** (with `MEDIA_ASSET` and/or `GENERATED_ASSET` clip sources). Resolve bytes via StoragePort from those assets only. |
| D5 | Hard M4 boundary | No M5 Playback/VLC product, no M6 FinishedMovie/library writes, no M7 Share/Export/Publication, no M8 billing/platform ownership of creative meaning, no NLE. |
| D6 | UI | Minimal render status/review. **No NLE. No product playback player.** |
| D7 | Escalation | New product/architectural principles → STOP and escalate to CoS/Brett. |
| D8 | Job type | **`RENDER`** only (already reserved in JobType). Ban aliases (`AI_RENDER`, `FFMPEG_JOB`, …). |
| D9 | Port | **`RendererPort.render(input: RenderComposerInput) → RenderResultDocument`**. Attribution **outside** the port return. Amend/replace the Phase 1 stub that returned `RenderOutput` with `providerKey` on the port and implied FinishedMovie. |
| D10 | FinishedMovie | **Zero** `FinishedMovie` / `Publication` writes in M4. Successful render stops at RenderJob `SUCCEEDED` + output bytes. |
| D11 | Manifest | Assemble a YouFlicks-owned **`RenderManifest` schema v1**, fingerprint it, snapshot on the RenderJob (`payload`), then render. Manifest is derived then persisted — not vendor graph JSON. |
| D12 | Local/production | Local/deterministic renderer allowed for tests/dev only; never advertises production render availability. Production requires a genuine configured adapter. |

---

## 1. Objective

Turn a READY, versioned YouFlicks Timeline (clips resolving to MediaAsset and/or GeneratedAsset StoragePort keys) into a validated **render output** under StoragePort, tracked by a first-class **`RenderJob`**, **and nothing beyond that**.

Pipeline:

**… → M3 GeneratedAsset → (M4) RenderJob + output → M5 Playback → M6 FinishedMovie → …**

**Architectural rule:** Rendering is mechanical assembly of an already-decided cut. It must not invent creative meaning, mutate Timeline/Story/Plan, or promote a library FinishedMovie.

---

## 2. Must include

1. **Harden `RenderJob` persistence**
   - Project-linked; required `timelineId` + `timelineVersion`
   - Status: `QUEUED` | `RUNNING` | `SUCCEEDED` | `FAILED` | `CANCELLED` (align with stub; in-progress may live on both Job and RenderJob — prefer Job for queue semantics and keep RenderJob status mirrored)
   - `outputKey` opaque StoragePort key on success
   - `payload` = snapshotted validated RenderManifest (+ optional progress)
   - Provenance: `jobId`, `inputFingerprint`, `providerKey`, `capability` (e.g. `VIDEO_RENDER`), optional model fields
   - durationMs / mimeType / byteSize / checksum when known
   - Prior successful renders preserved (new RenderJob rows; do not overwrite)

2. **`RendererPort` (provider-neutral) — Phase 1 stub amended**
   - `render(input: RenderComposerInput) → RenderResultDocument`
   - Document includes opaque `storageKey`, `durationMs`, mime/size/checksum as applicable — **not** `providerKey` on the return
   - Adapters remain replaceable (local FFmpeg, cloud render, …) behind the port
   - Container `renderer()` must stop throwing “not configured” once a genuine adapter exists

3. **RenderManifest schema v1 (owned)**
   - Built by `RenderService` from READY Timeline + resolved asset keys
   - Clip list with timeline timings, sourceKind, resolved storage keys (opaque), transitions, captions
   - Output profile (YouFlicks profile key — see §4)
   - No raw FFmpeg filter graphs / vendor job JSON as architectural truth (adapters may derive graphs privately)

4. **`RenderService` + `RenderWorker`**
   - Require READY Timeline; resolve all clip sources (fail typed if missing READY asset bytes)
   - Assemble manifest; fingerprint; enqueue
   - Worker calls RendererPort; validates result; persists SUCCEEDED RenderJob; attribution outside port
   - HTTP enqueue → **202**; no long-running render on HTTP

5. **Async lifecycle**
   - Job type **`RENDER`**
   - Cancel → Job/RenderJob `CANCELLED`; partial output not SUCCEEDED
   - Retry: new attempt or new RenderJob without corrupting prior SUCCEEDED rows
   - Idempotency: identical open RUNNING fingerprint must not double-create duplicate active work (mirror prior milestones)

6. **Provenance / privacy**
   - Fingerprint assembled manifest/input
   - No credentials, emails, sponsor records, vendor URLs as truth in manifest
   - Attribution via ProviderAttribution / adapter metadata outside port return

7. **Minimal UI**
   - User-visible: “Your movie” / Render / status / progress if available / success with **non-playback** confirmation (e.g. “Ready to watch later”)
   - **No** VLC/libVLC player, scrubbing NLE, Generate Film chat

8. **Owner-only APIs**
   - POST render (202)
   - GET job / RenderJob status
   - GET latest successful render metadata (not a streaming playback product)
   - Availability honesty

9. **Tests**
   - Enqueue ≠ SUCCEEDED
   - READY Timeline required; unresolved clip sources fail honestly
   - Fingerprint / provenance
   - Local ≠ production
   - Ownership
   - **Zero** FinishedMovie / Publication writes
   - Cancel / failure semantics
   - RendererPort return has no providerKey; AiDirector/Story/Timeline/Asset ports unchanged

---

## 3. Must not include

- FinishedMovie create/update/promote
- Publication / share / export
- PlaybackPort / VLC / libVLC product surfaces
- NLE editing
- Mutating prior PHASE_* lock files
- Writing vendor CDN URLs as `outputKey` truth
- Billing / sponsorship influencing render
- Expanding CreativePlan / StoryDocument / TimelineDocument / GeneratedAssetDocument with render graphs
- Job aliases other than **`RENDER`**

DB scope: harden **RenderJob** (+ optional indexes/provenance columns). No FinishedMovie/Publication schema productization beyond unused stubs.

---

## 4. Contracts

**Consume:** READY TimelineDocument + TimelineClip rows; MediaAsset / GeneratedAsset StoragePort keys; StoragePort; JobQueuePort.

**`RenderComposerInput` must include:**

- projectId, timelineId, timelineVersion
- Snapshotted RenderManifest (or enough to rebuild identically)
- Output profile key
- Opaque destination key hint (service-assigned final key preferred)

**Must not include:** credentials, sponsor records, user email, vendor host JSON, playback device config

**Amend Phase 1 `RendererPort`:**

| Before (Phase 1 stub) | M4 lock |
| --- | --- |
| `render(RenderInput) → RenderOutput` with `providerKey` on port/return; comment implies FinishedMovie | `render(RenderComposerInput) → RenderResultDocument`; attribution outside; **no** FinishedMovie |

### RenderManifest schema v1 (field lock)

```
RenderManifest
├── schemaVersion                 # "1.0"
├── timelineId
├── timelineVersion
├── totalDurationMs
├── outputProfile                 # WEB_720 | WEB_1080 | MASTER (YouFlicks profiles — not vendor codec enums)
├── clips[]
│   ├── clipId
│   ├── trackKey
│   ├── sourceKind                # MEDIA_ASSET | GENERATED_ASSET
│   ├── sourceId                  # asset id matching sourceKind
│   ├── storageKey                # opaque resolved key
│   ├── timelineStartMs
│   ├── timelineEndMs
│   ├── sourceInMs?
│   ├── sourceOutMs?
│   ├── transitionFromPrevious?
│   └── captionText?
├── audioMixNotes?                # optional light YouFlicks hints — not FFmpeg graphs
└── rationale?
```

### RenderResultDocument (port return)

```
RenderResultDocument
├── storageKey                    # opaque
├── mimeType
├── durationMs
├── byteSize?
├── checksum?
├── width?
└── height?
```

---

## 5. Database / provenance

Harden existing `RenderJob`:

- Require `timelineId`, add `timelineVersion`, `jobId`, `inputFingerprint`, `capability`, non-null `providerKey` on success path
- `payload` = RenderManifest snapshot (+ optional progress JSON)
- Keep relation to FinishedMovie for **M6 only** — M4 must not create FinishedMovie rows

---

## 6. Services

| Piece | Role |
| --- | --- |
| **`RendererPort`** | `render` → `RenderResultDocument` |
| **`RenderService`** | Manifest assemble; enqueue; persist; attribution |
| **`RenderWorker` + `RENDER`** | Off-HTTP |
| **Adapters** | Local/dev + production HTTP/process adapter |
| Timeline / assets | **Inputs only** |

Playback / FinishedMovie services remain unimplemented.

---

## 7. APIs / UI

- Render → 202 `RENDER`
- Status / cancel
- Latest render metadata
- Copy: “Your movie”, Render, status. Hide providers/ffmpeg.

Must not appear: NLE, VLC player, Share, Library FinishedMovie keep flow (M6).

---

## 8. Acceptance criteria

- [ ] RenderJob hardened with timeline provenance, fingerprint, manifest snapshot, opaque outputKey
- [ ] RendererPort amended per D9; attribution outside return
- [ ] HTTP enqueues **`RENDER`** (202); worker renders
- [ ] READY Timeline required; MEDIA_ASSET + GENERATED_ASSET sources resolve via StoragePort
- [ ] Local ≠ production availability
- [ ] Cancel / fail / retry do not corrupt prior SUCCEEDED renders
- [ ] Minimal status UI only — no NLE / VLC / Share
- [ ] Zero FinishedMovie / Publication writes
- [ ] Prior PHASE locks untouched
- [ ] Tests cover ownership, privacy, unresolved sources, zero M5–M7 product writes

---

## 9. Dependencies

| Dependency | Why |
| --- | --- |
| **M3 @ `4a0cb50`** | GENERATED_ASSET clip sources + StoragePort bytes |
| **M2 Timeline** | Executable cut |
| **StoragePort / JobQueue** | Bytes + async |

---

## 10. Relationship to M5–M8

- **M5** Playback consumes render output (prefer VLC/libVLC where practical) — separate port.
- **M6** Promotes a successful render to FinishedMovie / library.
- **M7** Share/Export/Publication.
- **M8** Platform — never owns creative meaning.

---

## 11. Risks

1. Premature FinishedMovie — mitigate: D10.  
2. Vendor graphs as domain truth — mitigate: owned RenderManifest only.  
3. Playback leaking into M4 UI — mitigate: D6.  
4. Phase 1 port stub with providerKey on interface — mitigate: D9 amend.  
5. Rendering with unmet roles still open — mitigate: allow render of current cut as-is; do not require zero unmetMediaRoles unless Brett later hardens (default: render READY Timeline even if unmet roles remain).  

---

## 12. Implementation sequence (when unlocked)

1. Keep this lock; no M5+.  
2. Harden RenderJob + provenance columns.  
3. RenderManifest v1 + RendererPort amend + privacy/validation.  
4. RenderService + RENDER worker (202).  
5. Adapters + production gating.  
6. APIs + minimal UI.  
7. §8 tests → Architect implementation review → checkpoint.

---

## 13. What M4 is

**M4 = Render (Timeline → StoragePort output via RenderJob).**

It sits between M3 Generated assets (`4a0cb50`) and M5 Playback. It does **not** mean the user has a FinishedMovie in their library.

**Architect APPROVED this lock (2026-09-09).** Implementation remains CLOSED until CoS authorizes Engineer under this lock. It is not implemented.

---

## Open questions

None requiring Brett hard-stop. Soft locks D8–D12 follow established YouFlicks patterns (Job naming, attribution-outside-port, no FinishedMovie until M6). Default: READY Timeline may render even if `unmetMediaRoles` remain (honest gaps). Escalate only if Brett wants “block render until unmet roles empty.”

---

## Review & approval log

| Role | Action | Date | Result |
| --- | --- | --- | --- |
| CoS / Brett | Autonomous M4 architecture gate after M3 CLOSED | 2026-09-09 | **AUTHORIZED** (implementation CLOSED) |
| Architect | Draft + self-review `PHASE_M4_RENDER_ROADMAP_DECISION.md` | 2026-09-09 | **APPROVED** |
| Chief of Staff | Engineer gate | — | **CLOSED** until CoS authorizes Engineer under this lock |
