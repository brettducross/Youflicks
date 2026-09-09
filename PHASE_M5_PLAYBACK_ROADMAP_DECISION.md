# Phase M5 Roadmap Decision Document — Playback

**Status:** Approved specification — not implemented  
**Milestone name:** M5 — Playback (Render output → watch)  
**Basis:** CoS autonomous M5 architecture gate after M4 CLOSED (2026-09-09); M4 checkpoint `421f2deeda5bb45cbd34b12e894ba06b20bc19db`; binding locks PHASE_2F / M1 / M2 / M3 / M4; provider-neutrality permanent  
**This document:** Authoritative specification for a **future** M5 implementation. M5 is **not started in code**. Do not treat this file as evidence that product playback exists. **Architect APPROVED this lock (2026-09-09). Implementation remains CLOSED until CoS authorizes Engineer under this lock.**

**Filename (locked):** `PHASE_M5_PLAYBACK_ROADMAP_DECISION.md` at repository root.  
**Do not** overwrite or mutate prior `PHASE_*` lock files.

Authoritative Git repository: clean public `github.com/brettducross/Youflicks`.  
Treat `421f2de` as the authoritative implementation checkpoint for M5 design.

Roadmap placement: **M5 = Playback** after M4 Render and before M6 FinishedMovie / Library.

---

## 0. Locked decisions

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | CreativePlan, StoryStructure, Timeline, GeneratedAsset, and Render contracts remain binding. M5 consumes a successful render; does not redefine upstream as provider-shaped. |
| D2 | M5 identity | M5 enables the owner to **watch** a successful M4 render. Playback is a **runtime viewing concern**, not a FinishedMovie library record (M6), not Share/Export (M7), not an NLE. |
| D3 | Provider neutrality | Permanent. Adapters only. **VLC / libVLC (when used) are adapters behind `PlaybackPort`**, never Prisma vendor enums or domain schema truth. |
| D4 | Input | Playback opens against a **SUCCEEDED `RenderJob`** with opaque `outputKey` (StoragePort). No vendor CDN URLs as domain truth. |
| D5 | Hard M5 boundary | No M6 FinishedMovie promotion/library keep ownership, no M7 Publication/share/export, no M8 billing/platform ownership of creative meaning, no NLE editing, no RenderJob redefinition as FinishedMovie. |
| D6 | Persistence | Playback sessions are **runtime (ephemeral)**. Do not invent a first-class FinishedMovie in M5. Optional short-lived server session tokens for ranged streaming are allowed; they are not library artifacts. |
| D7 | UI | Minimal authenticated **player** for the latest (or selected) successful render: play / pause / seek / status. **Not** an NLE. Not share chrome. |
| D8 | Escalation | New product/architectural principles → STOP and escalate to CoS/Brett. |
| D9 | Port | **`PlaybackPort`** — YouFlicks-owned viewing boundary. Soft shape below. Do not overload RendererPort. |
| D10 | Job type | **No** creative AI job required for ordinary playback. Streaming/open is request-path (with owner auth). Do not invent `AI_PLAYBACK`. Optional future `PLAYBACK_PREPARE` only if a concrete prep worker appears — **out of M5 default**. |
| D11 | Preferred adapters | Prefer **libVLC / VLC** where practical for desktop/native; web may use a **browser media adapter** behind the same port. Domain code never imports VLC types into Prisma/domain models. |
| D12 | Local/production | Local file playback via StoragePort is fine in all envs when StoragePort is local. “Production availability” means authenticated owner can stream a SUCCEEDED render’s opaque key — not a fake film library. |

---

## 1. Objective

Let a project **owner** watch a **SUCCEEDED M4 `RenderJob`** output from StoragePort through a provider-neutral **`PlaybackPort`**, with minimal player UX — **and nothing beyond that**.

Pipeline:

**… → M4 RenderJob SUCCEEDED → (M5) Playback → M6 FinishedMovie / Library → …**

**Architectural rule:** Watching is not keeping. M5 does not promote library FinishedMovies. Rendering remains M4; creative meaning remains upstream.

---

## 2. Must include

1. **`PlaybackPort` (provider-neutral)**
   - Soft locked operations (exact TypeScript shaping at Engineer gate within this contract):
     - `open(input: PlaybackOpenInput) → PlaybackSession`
     - `getStatus(sessionId) → PlaybackStatus` (optional if session is client-driven)
     - `close(sessionId) → void`
   - `PlaybackOpenInput`: `projectId`, `renderJobId` (must be SUCCEEDED, owner-scoped), optional start position
   - `PlaybackSession`: opaque session id, durationMs, mimeType, transport hints **without** vendor URLs as domain truth (e.g. app-relative stream path `/api/.../playback/...` or byte-range handle)
   - Adapters: `VlcPlaybackAdapter` (preferred where practical), `WebMediaPlaybackAdapter` (HTML5 for web), both replaceable

2. **Owner-authenticated stream access**
   - Resolve RenderJob → opaque `outputKey` → StoragePort ranged read
   - Owner-only APIs; cross-user blocked
   - No public unauthenticated CDN of renders in M5

3. **`PlaybackService`**
   - Verify ownership + RenderJob SUCCEEDED
   - Open session via PlaybackPort / or authorize stream URL
   - Never create FinishedMovie / Publication
   - Never mutate RenderJob output bytes as “library keep”

4. **Minimal player UI**
   - User-visible: “Watch” on Your movie / player controls (play, pause, seek, time)
   - Copy must not claim library keep / share
   - Hide VLC / ffmpeg / StoragePort vocabulary

5. **Security / privacy**
   - Authn + project ownership on every stream request
   - Short-lived authorization for byte-range responses
   - No sponsor/billing influence; no email/secrets in playback payloads

6. **Failure semantics**
   - Missing/non-SUCCEEDED render → typed error
   - Missing storage bytes → typed error
   - Adapter unavailable → typed error (web adapter may still work if VLC unavailable — capability honesty per surface)

7. **Tests**
   - Owner can open playback for SUCCEEDED render
   - Stranger blocked
   - Non-SUCCEEDED RenderJob rejected
   - Vendor URL not accepted as `outputKey` truth
   - Zero FinishedMovie / Publication writes
   - Domain has no VLC Prisma columns
   - RendererPort / upstream ports unchanged

---

## 3. Must not include

- FinishedMovie create/update/promote / library shelves
- Publication / share / download-as-export product (M7)
- NLE editing
- Re-running creative pipeline as part of “play”
- Embedding libVLC types in domain/Prisma
- Mutating PHASE_2F–M4 lock files
- Billing / sponsorship
- Treating PlaybackSession as durable creative artifact

DB scope: **prefer no new durable creative tables**. Ephemeral sessions may be in-memory / signed tokens. If a thin `playback_session` table is used for audit, it must not be a FinishedMovie and must expire.

---

## 4. Contracts

**Consume:** SUCCEEDED RenderJob (`outputKey`, mimeType, durationMs, projectId, timeline provenance as display metadata only).

**Do not redefine:** RendererPort, Timeline, GeneratedAsset, Story, CreativePlan.

### Soft `PlaybackPort` field tree

```
PlaybackOpenInput
├── projectId
├── renderJobId
└── startMs?

PlaybackSession
├── sessionId
├── renderJobId
├── durationMs
├── mimeType
├── transport                    # APP_STREAM | NATIVE_HANDLE (adapter-specific detail stays in adapter)
└── streamPath?                  # app-relative only when APP_STREAM — never vendor CDN as truth
```

Attribution: playback adapters are not creative AI; ProviderAttribution optional only if a remote playback service is used (default local/stream: skip).

---

## 5. Services / APIs / UI

| Piece | Role |
| --- | --- |
| **`PlaybackPort`** | Open/close viewing session |
| **`PlaybackService`** | Authz; resolve RenderJob; open stream |
| **Adapters** | Web media + preferred VLC/libVLC where practical |
| RenderService | **Input only** (SUCCEEDED jobs) |

**APIs (owner-only):**
- `POST .../playback/open` → session
- `GET .../playback/stream` (or session-scoped) → ranged bytes from StoragePort
- `POST .../playback/close`

**UI:** Watch control on render success surface; simple player. No Share / Keep / NLE.

---

## 6. Acceptance criteria

- [ ] Owner can play a SUCCEEDED RenderJob via PlaybackPort / authenticated stream
- [ ] VLC/libVLC (if present) is adapter-only — not domain schema
- [ ] Opaque StoragePort keys only; no vendor URL domain truth
- [ ] Cross-user access blocked
- [ ] Minimal player UI only — no NLE / Share / library keep
- [ ] Zero FinishedMovie / Publication writes
- [ ] Upstream ports and PHASE_2F–M4 locks untouched
- [ ] Tests cover ownership, non-SUCCEEDED rejection, zero M6–M7 writes

---

## 7. Dependencies

| Dependency | Why |
| --- | --- |
| **M4 @ `421f2de`** | SUCCEEDED RenderJob + opaque output |
| **StoragePort** | Byte-range read |
| **Auth** | Owner isolation |

---

## 8. Relationship to M6–M8

- **M6** FinishedMovie + Library — “keep this film”
- **M7** Share / Export / Publication
- **M8** Platform — never owns creative meaning

M5 only watches.

---

## 9. Risks

1. Premature FinishedMovie — mitigate: D2/D5/D6.  
2. VLC leaking into Prisma — mitigate: D3/D11.  
3. Public unauthenticated media URLs — mitigate: owner auth on stream.  
4. Building an NLE around the player — mitigate: D7.  
5. Web-only vs VLC-only — mitigate: dual adapters behind one port (D11).

---

## 10. Implementation sequence (when unlocked)

1. Keep this lock; no M6+.  
2. PlaybackPort + PlaybackService + owner stream route (StoragePort ranges).  
3. WebMedia adapter; VLC/libVLC adapter where practical.  
4. Minimal Watch UI on render surface.  
5. §8 tests → Architect implementation review → checkpoint.

---

## 11. What M5 is

**M5 = Playback (watch a successful render).**

It sits between M4 Render (`421f2de`) and M6 FinishedMovie. It does **not** mean the film is kept in a library.

**Architect APPROVED this lock (2026-09-09).** Implementation remains CLOSED until CoS authorizes Engineer under this lock. It is not implemented.

---

## Open questions

None requiring Brett hard-stop. Soft D9–D12 follow established port/adapter patterns and the longstanding “prefer VLC where practical, separate from creative orchestration” rule. Dual web + VLC adapters behind one port avoids a false choice.

---

## Review & approval log

| Role | Action | Date | Result |
| --- | --- | --- | --- |
| CoS / Brett | Autonomous M5 architecture gate after M4 CLOSED | 2026-09-09 | **AUTHORIZED** (implementation CLOSED) |
| Architect | Draft + self-review `PHASE_M5_PLAYBACK_ROADMAP_DECISION.md` | 2026-09-09 | **APPROVED** |
| Chief of Staff | Engineer gate | — | **CLOSED** until CoS authorizes Engineer under this lock |
