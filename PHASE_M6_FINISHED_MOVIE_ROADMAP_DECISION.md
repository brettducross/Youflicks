# Phase M6 Roadmap Decision Document — FinishedMovie / Library Keep

**Status:** Approved specification — not implemented  
**Milestone name:** M6 — FinishedMovie (Library keep — “Keep this film”)  
**Basis:** CoS autonomous M6 architecture gate after M5 CLOSED (2026-09-09); M5 checkpoint `origin/main` `92a28f1d01b9c349bcebe9c92a1bd2b93eec13c4`; prior M5 docs `4f3d906`; M4 `421f2de`; binding locks PHASE_2F / M1 / M2 / M3 / M4 / M5; provider-neutrality permanent  
**This document:** Authoritative specification for a **future** M6 implementation. M6 is **not started in code**. Do not treat this file as evidence that product library keep exists. **Architect APPROVED this lock (2026-09-09). Implementation remains CLOSED until CoS authorizes Engineer under this lock.** Baseline checkpoint `92a28f1`.

**Filename (locked):** `PHASE_M6_FINISHED_MOVIE_ROADMAP_DECISION.md` at repository root.  
**Do not** overwrite or mutate prior `PHASE_*` lock files (including PHASE_2F–M5).

Authoritative Git repository: clean public `github.com/brettducross/Youflicks`.  
Treat `92a28f1d01b9c349bcebe9c92a1bd2b93eec13c4` as the authoritative implementation checkpoint for M6 design (M5 CLOSED).

Roadmap placement: **M6 = FinishedMovie / Library keep** after M5 Playback and before M7 Share / Export / Publication.

Existing Prisma stub `FinishedMovie` (id, projectId, renderJobId?, title, durationMs?, storageKey?, status PROCESSING|READY|FAILED, publications relation) is the harden target — M6 hardens this stub; it does not invent a parallel creative identity.

---

## 0. Locked decisions

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | CreativePlan…Playback contracts remain binding. M6 consumes a **SUCCEEDED `RenderJob`**; does not redefine upstream as provider-shaped. |
| D2 | M6 identity | **FinishedMovie** is a first-class YouFlicks-owned **library keep** artifact (“Keep this film”). Distinct from RenderJob (mechanical output) and PlaybackSession (ephemeral watch). Not Share/Export (M7), not NLE, not billing. |
| D3 | Provider neutrality | Permanent. No vendor enums. Library keep uses **StoragePort only**; no creative AI vendor port required for Keep. |
| D4 | Promotion input | Every FinishedMovie KEEP derives from **exactly one SUCCEEDED RenderJob** (required `renderJobId`). Opaque StoragePort keys only. |
| D5 | Explicit Keep | User must **explicitly Keep**. **No** silent FinishedMovie on Render SUCCEEDED or on Watch open (mirrors M3 explicit Rebuild). Watching ≠ keeping. |
| D6 | Storage semantics | On Keep, FinishedMovie owns a **library opaque `storageKey`**. Implementation MUST copy (or StoragePort-equivalent durable clone) bytes from `RenderJob.outputKey` into a library key path (e.g. `projects/{projectId}/movies/{movieId}/…`). Do not make FinishedMovie a thin mutable pointer that breaks if render outputs are GC’d. Provenance retains `renderJobId`. Vendor CDN URLs forbidden as truth. |
| D7 | Hard M6 boundary | No M7 Publication/share/export product chrome or Publication writes as a product feature; no M8 billing ownership of creative meaning; no NLE; no redefining PlaybackSession as library keep; do not mutate PHASE_2F–M5 locks. |
| D8 | Persistence / status | Harden FinishedMovie: project-linked; required `renderJobId` on keep; title; `durationMs`/`mimeType`/`byteSize`/`checksum` when known; opaque `storageKey` required when READY; status **READY \| ARCHIVED \| FAILED** (in-progress belongs on Job if copy is async — do not use PROCESSING as a durable creative “in progress” synonym for keep; if Engineer keeps a transient PROCESSING during copy, it must never be listed as a kept film). Multiple keeps per project allowed (new rows). Archive soft (no immediate byte delete). Prior keeps preserved. |
| D9 | Port / service | **No** new creative AI port. Soft: `MovieService.keep \| list \| get \| archive` (+ optional unarchive). Uses StoragePort + auth. Optional thin `LibraryPort` unnecessary — prefer MovieService. Do not overload PlaybackPort/RendererPort with keep semantics. |
| D10 | Job type | If byte copy is non-trivial, enqueue **`LIBRARY_KEEP`**. Ban `AI_LIBRARY`, `AI_MOVIE`. Sync keep allowed when copy is fast/local; still must not invent creative AI jobs. HTTP keep → **202** when async. |
| D11 | UI | Minimal authenticated Keep + Library: “Keep this film” on successful render/watch surface; Library list (title, duration, kept time, status); open/watch a kept film; Archive. **No** Share/Export/Publish buttons. Hide job/storage vocabulary. Watch of a kept film may stream `FinishedMovie.storageKey` via owner-auth app stream **reusing PlaybackPort session pattern** (extend open input with `finishedMovieId` discriminator in M6 code — do not rewrite M5 lock file). |
| D12 | Local/production | Library keep available whenever StoragePort can copy/store; no fake “production AI library”. Availability honesty: `canKeep` when owner + SUCCEEDED render exists + storage writable. |

---

## 1. Objective

Let a project **owner** explicitly **Keep** a **SUCCEEDED M4 `RenderJob`** into a durable YouFlicks-owned **FinishedMovie** library artifact — with opaque library storage, soft archive, and minimal Library UX — **and nothing beyond that**.

Pipeline:

**… → M4 RenderJob SUCCEEDED → M5 Playback (watch) → (M6) FinishedMovie Keep / Library → M7 Share / Export → …**

**Architectural rule:** Watching is not keeping. Keeping is not sharing. M6 does not publish, export, bill, or edit. Rendering remains M4; playback remains M5; creative meaning remains upstream.

---

## 2. Must include

1. **Hardened `FinishedMovie`** — Durable project-linked row; required `renderJobId` (SUCCEEDED at keep); title; opaque library `storageKey` when READY; optional `durationMs`/`mimeType`/`byteSize`/`checksum`/`inputFingerprint`; status **READY | ARCHIVED | FAILED**; multiple keeps/project; soft archive; prior keeps preserved.

2. **Explicit Keep** — User-initiated only (never on Render SUCCEEDED or Playback open). Verify ownership + SUCCEEDED + storage writable; durable-copy `RenderJob.outputKey` → library key. Sync if fast/local; else **`LIBRARY_KEEP`** + **HTTP 202**. Transient copy never listed as kept film.

3. **`MovieService`** — Soft: `keep | list | get | archive` (+ optional unarchive). StoragePort + auth. No new creative AI port. Prefer MovieService over thin `LibraryPort`. Do not overload PlaybackPort/RendererPort.

4. **Library storage (D6)** — Owns library opaque `storageKey` (e.g. `projects/{projectId}/movies/{movieId}/…`), not a thin render pointer. Provenance retains `renderJobId`. Vendor CDN URLs forbidden as truth.

5. **Minimal Keep + Library UI** — “Keep this film”; list (title, duration, kept time, status); watch kept; Archive. **No** Share/Export/Publish. Hide job/storage vocabulary. Stream kept film via PlaybackPort + `finishedMovieId` (M6 code only; do not rewrite M5 lock).

6. **Security** — Owner-only; cross-user blocked; no sponsor/billing/secrets in keep payloads; zero Publication product writes (relation may remain unused).

7. **Failures** — Non-SUCCEEDED/missing → typed error; copy fail → FAILED (never READY without library bytes); `canKeep` = owner + SUCCEEDED + storage writable.

8. **Tests (parallel M5)** — Owner Keep → READY + library key; stranger blocked; non-SUCCEEDED rejected; no silent keep; durable copy; vendor URL rejected; zero Publication writes; no vendor enums; ports not overloaded; async `LIBRARY_KEEP`/202; soft archive; multiple keeps; PHASE_2F–M5 untouched.

---

## 3. Must not include

- Silent FinishedMovie on Render SUCCEEDED or Watch open
- Thin pointer-only keep orphaned by render GC
- Publication/share/export product chrome or Publication **product** writes (M7)
- NLE; re-running creative pipeline as Keep
- Creative AI port or jobs `AI_LIBRARY` / `AI_MOVIE`
- Overloading PlaybackPort/RendererPort; redefining PlaybackSession as keep
- Billing/sponsorship ownership of creative meaning (M8)
- Mutating PHASE_2F–M5 locks; fake “production AI library”
- Listing transient PROCESSING as a kept film

DB scope: **harden existing FinishedMovie stub**. Publications relation may remain unused. Prefer Job for async copy progress — not durable PROCESSING-as-creative-status.

---

## 4. Contracts / schema

**Consume:** SUCCEEDED RenderJob (`outputKey`, mimeType, durationMs, projectId, timeline provenance as display/provenance only).

**Do not redefine:** RendererPort, PlaybackPort (M5 lock untouched; M6 code may extend open input with `finishedMovieId`), Timeline, GeneratedAsset, Story, CreativePlan.

### Hardened FinishedMovie field tree

```
FinishedMovie
├── id
├── projectId                    # required
├── renderJobId                  # required on keep — exactly one SUCCEEDED source
├── title                        # required for library display
├── status                       # READY | ARCHIVED | FAILED
├── storageKey?                  # opaque StoragePort — required when READY
├── durationMs?
├── mimeType?
├── byteSize?
├── checksum?                    # when known
├── inputFingerprint?            # optional hash(source outputKey + renderJobId)
├── createdAt / updatedAt / keptAt?
└── publications                 # schema may remain; ZERO product writes in M6
```

### Optional FinishedMovieDocument (minimal)

```
FinishedMovieDocument
├── schemaVersion
├── title
├── source
│   ├── renderJobId              # required
│   └── timelineVersion?         # optional display provenance
├── durationMs?
└── mimeType?
```

Do not embed vendor URLs, billing, or share targets.

### Soft MovieService

```
keep({ projectId, renderJobId, title? }) → FinishedMovie | { jobId, status: ACCEPTED }
list({ projectId, includeArchived? }) → FinishedMovie[]
get({ movieId }) → FinishedMovie
archive({ movieId }) → FinishedMovie
unarchive?({ movieId }) → FinishedMovie
```

### Job type (when async)

- **`LIBRARY_KEEP`** only. Ban `AI_LIBRARY`, `AI_MOVIE`. Sync keep allowed when fast/local.

### Playback reuse (code only — do not rewrite M5 lock)

```
PlaybackOpenInput (M6 code extension)
├── projectId
├── renderJobId?                 # existing M5 path
├── finishedMovieId?             # M6 — stream FinishedMovie.storageKey
└── startMs?
```

Exactly one of `renderJobId` / `finishedMovieId`. Owner-auth app stream; opaque keys only. Keep is not creative AI — no ProviderAttribution required for StoragePort copy.

---

## 5. Services / APIs / UI

| Piece | Role |
| --- | --- |
| **`MovieService`** | Keep / list / get / archive; ownership; StoragePort copy |
| **StoragePort** | Durable library clone from render `outputKey` → library `storageKey` |
| **Job (`LIBRARY_KEEP`)** | Optional async copy worker |
| **PlaybackPort** (reuse) | Watch kept film via `finishedMovieId` (M6 code; M5 lock unchanged) |
| Render / Playback services | Input / watch only — do not own keep |

**APIs (owner-only):** `POST .../movies/keep` → 200 FinishedMovie or 202 KeepJobRef; `GET .../movies`; `GET .../movies/:id`; `POST .../movies/:id/archive` (+ optional unarchive); watch via playback open/stream with `finishedMovieId`.

**UI:** “Keep this film”; Library list; watch kept; Archive. No Share/Export/Publish. Show Keep only when `canKeep`. Hide job/storage vocabulary.

---

## 6. Acceptance criteria

- [ ] Owner can explicitly Keep a SUCCEEDED RenderJob → FinishedMovie READY with opaque library `storageKey`
- [ ] Bytes copied (or StoragePort-equivalent durable clone) into library path — not pointer-only to render output as sole truth
- [ ] No silent FinishedMovie on Render SUCCEEDED or Playback open
- [ ] Status READY | ARCHIVED | FAILED for durable keep; transient copy never listed as kept film
- [ ] Multiple keeps per project; prior keeps preserved; soft archive
- [ ] Cross-user blocked on keep / list / get / archive / stream
- [ ] Opaque StoragePort keys only; no vendor URL domain truth
- [ ] Minimal Keep + Library UI — no NLE / Share / Export / Publish
- [ ] Zero Publication product writes in M6
- [ ] No new creative AI port; `LIBRARY_KEEP` only when async; ban `AI_LIBRARY` / `AI_MOVIE`
- [ ] Watch kept film reuses PlaybackPort with `finishedMovieId` (M5 lock file not rewritten)
- [ ] Upstream ports and PHASE_2F–M5 locks untouched
- [ ] Tests: ownership, non-SUCCEEDED rejection, no auto-keep, durable copy, zero M7 writes, async 202
- [ ] `canKeep` honesty: owner + SUCCEEDED render + storage writable

---

## 7. Dependencies

| Dependency | Why |
| --- | --- |
| **M5 CLOSED @ `92a28f1`** | Playback as watch path; M6 adds keep without redefining watch |
| **M4 @ `421f2de`** | SUCCEEDED RenderJob + opaque `outputKey` |
| **StoragePort** | Durable library copy / ranged read |
| **Auth** | Owner isolation |
| **Existing FinishedMovie stub** | Harden target (not a parallel identity) |

---

## 8. Relationship to M7–M8

- **M7** Share / Export / Publication — first place for Publication product writes and share/export chrome
- **M8** Platform / billing — never owns creative meaning; keep payloads stay free of sponsor/billing fields

M6 only keeps. Watching remains M5. Sharing is out of scope.

---

## 9. Risks

1. **Collapsing keep into render** — mitigate: D2/D4/D6 (FinishedMovie owns library key + provenance).  
2. **Silent auto-keep** — mitigate: D5 (explicit Keep; mirrors M3 Rebuild).  
3. **Share chrome leak** — mitigate: D7 / §3 / UI ban.  
4. **Pointer-only keep orphaned by render GC** — mitigate: D6 mandatory durable copy/clone.  
5. **NLE around library** — mitigate: D2/D7/D11.  
6. **PROCESSING as durable creative status** — mitigate: D8 (READY|ARCHIVED|FAILED; progress on Job).  
7. **Creative AI job invent** (`AI_LIBRARY` / new AI port) — mitigate: D3/D9/D10.

---

## 10. Implementation sequence (when unlocked)

1. Keep this lock; no M7+ product work under M6. Do not mutate PHASE_2F–M5.  
2. Harden FinishedMovie schema (required `renderJobId`, status READY|ARCHIVED|FAILED, library fields).  
3. MovieService.keep/list/get/archive + StoragePort durable copy; `LIBRARY_KEEP` when async (202).  
4. Minimal Keep + Library UI; no Share/Export/Publish.  
5. Extend Playback open (code only) with `finishedMovieId` for watch-kept-film.  
6. §6 tests → Architect implementation review → checkpoint.

---

## 11. What M6 is

**M6 = FinishedMovie / Library keep (“Keep this film”).**

It sits between M5 Playback (`92a28f1` / docs `4f3d906`) and M7 Share / Export / Publication. It does **not** mean the film is shared, exported, billed, or edited in an NLE. Watching remains M5; keeping is an explicit owner action that creates a durable YouFlicks-owned library artifact with its own opaque storage.

**Architect APPROVED this lock (2026-09-09).** Implementation CLOSED until CoS authorizes Engineer. Not implemented. Baseline checkpoint `92a28f1`.

---

## Open questions

None requiring Brett hard-stop. D1–D12 follow established explicit-action + owned-artifact patterns (M3 Rebuild; StoragePort opacity; no creative AI for library copy). Escalation set **R = empty**.

---

## Review & approval log

| Role | Action | Date | Result |
| --- | --- | --- | --- |
| CoS / Brett | Autonomous M6 architecture gate after M5 CLOSED (`92a28f1`) | 2026-09-09 | **AUTHORIZED** (implementation CLOSED) |
| Architect | Draft + self-review `PHASE_M6_FINISHED_MOVIE_ROADMAP_DECISION.md` | 2026-09-09 | **APPROVED** (autonomous mode; no Brett escalations — R set empty) |
| Architect | FINAL APPROVE | 2026-09-09 | **APPROVED** — binding soft-locks D1–D12 consistent with prior milestones |
| Chief of Staff | Engineer gate | — | **CLOSED** until CoS authorizes Engineer under this lock |
