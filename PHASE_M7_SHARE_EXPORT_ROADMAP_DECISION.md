# Phase M7 Roadmap Decision Document — Share / Export / Publication

**Status:** Approved specification — not implemented  
**Milestone name:** M7 — Share / Export / Publication  
**Basis:** CoS autonomous M7 architecture gate after M6 CLOSED (2026-09-09); M6 checkpoint `origin/main` `13881f323d4a6438fd7eba2c11caa0d5968fe48c`; prior M6 docs `d17a96b`; M5 `92a28f1`; binding locks PHASE_2F / M1 / M2 / M3 / M4 / M5 / M6; provider-neutrality permanent  
**This document:** Authoritative specification for a **future** M7 implementation. M7 is **not started in code**. Do not treat this file as evidence that product share/export exists. **Architect APPROVED this lock (2026-09-09). Implementation remains CLOSED until CoS authorizes Engineer under this lock.** Baseline checkpoint `13881f3`.

**Filename (locked):** `PHASE_M7_SHARE_EXPORT_ROADMAP_DECISION.md` at repository root.  
**Do not** overwrite or mutate prior `PHASE_*` lock files (including PHASE_2F–M6).

Authoritative Git repository: clean public `github.com/brettducross/Youflicks`.  
Treat `13881f323d4a6438fd7eba2c11caa0d5968fe48c` as the authoritative implementation checkpoint for M7 design (M6 CLOSED).

Roadmap placement: **M7 = Share / Export / Publication** after M6 FinishedMovie / Library keep and before M8 Platform / billing.

Existing Prisma stub `Publication` (id, movieId, destinationKey string, status PENDING|PUBLISHED|FAILED, externalId?, payload Json?) is the harden target — M7 hardens this stub; it does not invent a parallel creative identity. `JobType` already reserves **`PUBLISH`**.

---

## 0. Locked decisions

| ID | Decision | Lock |
| --- | --- | --- |
| D1 | Upstream immutability | CreativePlan…FinishedMovie binding. M7 consumes **READY FinishedMovie** only; does not redefine upstream as provider-shaped. Watching/keeping remain M5/M6. |
| D2 | M7 identity | **Share / Export / Publication.** **Publication** is the first-class YouFlicks-owned record of a share or export attempt against exactly one READY FinishedMovie. Distinct from FinishedMovie (library keep). Not billing (M8), not NLE, not creative AI meaning. |
| D3 | Provider neutrality | Permanent. Destination adapters behind **`PublicationPort`** (soft name). `destinationKey` is an open string (provenance/adapter key), never a Prisma vendor enum. YouTube/etc may exist later as adapters — not domain truth. |
| D4 | Input | Every Publication derives from **exactly one READY FinishedMovie** (required `movieId`). Opaque `FinishedMovie.storageKey` via StoragePort. No vendor CDN as domain truth. |
| D5 | Explicit action | Owner must explicitly Export or Share. **No** silent Publication on Keep success or Watch open. |
| D6 | Destination set (v1 exit) | Required adapters: **`DOWNLOAD`** — owner-auth export of FinishedMovie bytes (`Content-Disposition: attachment`); Publication records the attempt. **`SHARE_LINK`** — owner creates a **time-limited, revocable YouFlicks share token** for **watch-only** non-owners (no project membership, no library keep, no NLE, no re-export by default). Token/session is runtime + optional thin Publication payload; not a second FinishedMovie. Permanent unauthenticated public CDN of library bytes is **forbidden**. External social (`youtube`, …) may register later behind the same port — **not required** for M7 exit. |
| D7 | Hard M7 boundary | No M8 billing/subscriptions/quotas ownership of creative meaning; no NLE; no redefining FinishedMovie as Publication; no new creative AI ports/jobs; do not mutate PHASE_2F–M6; sponsorship placements remain post-film presentation only (Phase 2D) — M7 must not let sponsors steer share targets as creative meaning. |
| D8 | Persistence / status | Harden Publication: `movieId` required; `destinationKey`; status **PENDING \| PUBLISHED \| FAILED \| REVOKED** (extend stub with REVOKED; in-progress on Job when async); optional `externalId`, `payload` (YouFlicks-owned: `expiresAt`, `revokedAt`, `tokenFingerprint` — never raw secrets). Multiple Publications per movie; prior rows preserved. |
| D9 | Ports / services | Soft: **`PublicationPort.publish(input) → PublicationResult`** — adapter boundary (DOWNLOAD may be no-op/local; SHARE_LINK issues token; future youtube uploads). Attribution outside port if remote. **`PublicationService`** — authz; require READY; enqueue or sync; validate; persist; revoke. Do not overload MovieService/PlaybackPort/RendererPort with publish semantics (Playback may be reused for share-link watch with share-token auth — M7 code extension; do not rewrite M5/M6 locks). |
| D10 | Job type | Use existing **`PUBLISH`**. Ban `AI_PUBLISH`, `AI_SHARE`. Sync DOWNLOAD allowed; SHARE_LINK may be sync; remote destinations → 202 + worker. |
| D11 | UI | Minimal authenticated Share / Export on Library kept film: Export download; Create/copy share link; list publications status; Revoke link. **No** NLE. Hide adapter/vendor vocabulary. SHARE_LINK recipients get watch-only player (no Keep/Share chrome for recipients unless owner). |
| D12 | Local/production | DOWNLOAD when StoragePort can read library bytes. SHARE_LINK when share-token signing secret configured. Honesty: `canExport` / `canShareLink`. Missing remote adapter → typed unavailable (not fake success). |

---

## 1. Objective

Let a project **owner** explicitly **Export** or **Share** a **READY M6 `FinishedMovie`** into a durable YouFlicks-owned **Publication** record — with provider-neutral destination adapters (`DOWNLOAD`, `SHARE_LINK` required for v1 exit), revocable time-limited share tokens for watch-only recipients, and minimal Share / Export UX — **and nothing beyond that**.

Pipeline:

**… → M5 Playback (watch) → M6 FinishedMovie Keep / Library → (M7) Share / Export / Publication → M8 Platform / billing → …**

**Architectural rule:** Keeping is not sharing. Sharing is not billing. M7 does not keep, bill, edit in an NLE, or redefine creative meaning. FinishedMovie remains M6; playback remains M5; creative meaning remains upstream.

---

## 2. Must include

1. **Hardened `Publication`** — Movie-linked; required `movieId` (READY at publish); open-string `destinationKey`; status **PENDING | PUBLISHED | FAILED | REVOKED**; optional `externalId`, `payload` (`expiresAt`, `revokedAt`, `tokenFingerprint` — never raw secrets); multiple Publications/movie; prior rows preserved.

2. **Explicit Export / Share** — Owner-initiated only (never on Keep success or Watch open). Verify ownership + READY + destination available. Sync if local/fast; else **`PUBLISH`** + **HTTP 202**.

3. **`PublicationPort` + `PublicationService`** — Soft port adapter boundary; service owns authz, READY check, persist, revoke. Do not overload MovieService / PlaybackPort / RendererPort.

4. **v1 destinations (D6)** — **`DOWNLOAD`**: owner-auth attachment export; Publication records attempt. **`SHARE_LINK`**: time-limited revocable watch-only token for non-owners. Permanent unauth public CDN **forbidden**. Future social adapters optional behind same port.

5. **Minimal Share / Export UI** — Export; Create/copy share link; list status; Revoke. No NLE. Hide vendor vocabulary. Recipients: watch-only player.

6. **Security / privacy** — Owner-only create/list/revoke. SHARE_LINK: signed token; expiry required (soft default e.g. 7d); revoke invalidates; watch-only; no project APIs; no listing other movies; rate-limit abuse as expectation. Export: owner auth; `Content-Disposition: attachment`; no public unauth download of library key. No emails/secrets/sponsor PII in payload as truth. Cross-user cannot export another owner's movie.

7. **Failures** — Non-READY → typed error; missing adapter/secret → typed unavailable (`canExport` / `canShareLink`); fail → FAILED; revoke → REVOKED.

8. **Tests** — Owner DOWNLOAD/SHARE_LINK; revoke; stranger blocked; non-READY rejected; no silent Publication; no public CDN; no vendor enums; ports not overloaded; async 202; PHASE_2F–M6 untouched; ban `AI_PUBLISH` / `AI_SHARE`.

---

## 3. Must not include

- Silent Publication on Keep success or Watch open
- Permanent unauthenticated public CDN of library bytes
- Redefining FinishedMovie as Publication; second FinishedMovie for recipients
- NLE; re-running creative pipeline as Share/Export
- Creative AI port or jobs `AI_PUBLISH` / `AI_SHARE`
- Overloading MovieService / PlaybackPort / RendererPort (share-token watch = M7 code only; do not rewrite M5/M6 locks)
- Billing / subscriptions / quotas ownership of creative meaning (M8)
- Prisma vendor enums for `destinationKey`
- Sponsors steering share targets as creative meaning (Phase 2D presentation only)
- Mutating PHASE_2F–M6; fake success when adapter/secret missing
- Emails, secrets, or sponsor PII in Publication payload as truth
- Re-export / Keep / project APIs for SHARE_LINK recipients by default

DB scope: **harden existing Publication stub** (add REVOKED; require movieId; open-string destinationKey). Prefer Job for async remote progress.

---

## 4. Contracts / schema

**Consume:** READY FinishedMovie (`storageKey` via StoragePort; title/duration/mime display; projectId authz).

**Do not redefine:** MovieService keep (M6 untouched), PlaybackPort (M5 untouched; M7 may extend share-token auth in code), RendererPort, Timeline, GeneratedAsset, Story, CreativePlan.

### Hardened Publication field tree

```
Publication
├── id
├── movieId                      # required — exactly one READY FinishedMovie
├── destinationKey               # open string — DOWNLOAD | SHARE_LINK | future youtube
├── status                       # PENDING | PUBLISHED | FAILED | REVOKED
├── externalId?                  # adapter-side id when remote
├── payload?                     # YouFlicks-owned Json — never raw secrets
│   ├── expiresAt?               # required for SHARE_LINK
│   ├── revokedAt?
│   ├── tokenFingerprint?        # hash — not the token
│   └── adapterMeta?             # non-secret notes only
├── createdAt / updatedAt / publishedAt?
└── (no vendor CDN URL as domain truth)
```

### Soft PublicationPort I/O

```
PublicationPort.publish(input) → PublicationResult

PublishInput
├── publicationId / movieId / destinationKey
├── storageKey                   # opaque FinishedMovie.storageKey
├── mimeType? / title?
└── options? { expiresAt?, contentDisposition? }

PublicationResult
├── status                       # PUBLISHED | FAILED | PENDING
├── externalId? / payload? / error?
```

DOWNLOAD may be no-op/local (app stream). SHARE_LINK issues token at service layer. Future remotes upload behind same port; attribution outside port.

### SHARE_LINK token semantics

```
ShareToken (runtime — not a second FinishedMovie)
├── signed JWT/opaque; claims: publicationId, movieId, exp (required), iat
├── watch-only scope             # no project membership / Keep / NLE / re-export by default
├── revoke → Publication REVOKED + token invalid on next verify
└── soft default TTL e.g. 7d (configurable); expiry required
```

Payload stores `tokenFingerprint` + `expiresAt` / `revokedAt` — never raw secret or raw token as durable truth.

### Soft PublicationService + Job

```
exportDownload({ movieId }) → Publication | stream attachment
createShareLink({ movieId, expiresAt? }) → { publication, shareUrl, token? }
list({ movieId }) → Publication[]
get({ publicationId }) → Publication
revoke({ publicationId }) → Publication   # SHARE_LINK → REVOKED
```

- Job: **`PUBLISH`** only. Ban `AI_PUBLISH`, `AI_SHARE`. Sync DOWNLOAD / SHARE_LINK allowed; remote → **202** + worker.

### Playback reuse (code only — do not rewrite M5/M6 locks)

```
PlaybackOpenInput (M7 SHARE_LINK recipient extension)
├── shareToken                   # watch-only auth
├── finishedMovieId?             # from token claims
└── startMs?
```

---

## 5. Services / APIs / UI

| Piece | Role |
| --- | --- |
| **`PublicationService`** | Authz; require READY; export / share / list / revoke; persist |
| **`PublicationPort`** | Destination adapters (`DOWNLOAD`, `SHARE_LINK`, future remotes) |
| **StoragePort** | Read opaque library `storageKey` for DOWNLOAD / share watch |
| **Job (`PUBLISH`)** | Optional async worker for remote destinations |
| **PlaybackPort** (reuse) | SHARE_LINK recipient watch-only via share-token auth (M7 code) |
| Movie / Playback services | Input / watch only — do not own publish |

**APIs (owner-only create/list/revoke):** `POST .../movies/:id/export` → 200 attachment + Publication or 202; `POST .../movies/:id/share-link` → 200 `{ publication, shareUrl }` or 202; `GET .../movies/:id/publications`; `POST .../publications/:id/revoke`; recipient watch via playback + share token.

**UI:** Export; Create/copy share link; list status; Revoke. Gate on `canExport` / `canShareLink`. Hide adapter vocabulary. Recipients: watch-only player.

---

## 6. Acceptance criteria

- [ ] Owner Export READY FinishedMovie → Publication `DOWNLOAD` + attachment stream
- [ ] Owner Create share link → Publication `SHARE_LINK`, signed time-limited token, payload `expiresAt` + `tokenFingerprint` (never raw secret)
- [ ] Owner Revoke → REVOKED; subsequent token verify fails
- [ ] No silent Publication on Keep success or Watch open
- [ ] Status PENDING | PUBLISHED | FAILED | REVOKED; async progress on Job
- [ ] Multiple Publications per movie; prior rows preserved
- [ ] Cross-user blocked on create / list / revoke / export
- [ ] SHARE_LINK recipients watch-only; no project APIs / other-movie listing / Keep/Share chrome / re-export by default
- [ ] Permanent unauth public CDN of library bytes forbidden
- [ ] Opaque StoragePort keys only; no vendor URL / Prisma vendor enum as domain truth
- [ ] Minimal Share / Export UI — no NLE; hide adapter vocabulary
- [ ] No new creative AI port; `PUBLISH` only; ban `AI_PUBLISH` / `AI_SHARE`
- [ ] Playback share-token watch is M7 code only (M5/M6 locks not rewritten)
- [ ] Upstream ports and PHASE_2F–M6 locks untouched
- [ ] Tests: ownership, non-READY rejection, no auto-publish, revoke, no public CDN, async 202, honesty flags
- [ ] `canExport` / `canShareLink` honesty; missing remote adapter → typed unavailable

---

## 7. Dependencies

| Dependency | Why |
| --- | --- |
| **M6 CLOSED @ `13881f3`** | READY FinishedMovie + opaque library `storageKey` |
| **M5 @ `92a28f1`** | Playback watch path; M7 extends recipient share-token auth (code only) |
| **StoragePort** | Read library bytes for DOWNLOAD / share watch |
| **Auth** | Owner isolation; share-token signing secret for SHARE_LINK |
| **Existing Publication stub** | Harden target; JobType `PUBLISH` already reserved |

---

## 8. Relationship to M8 + autonomous charter STOP

- **M8** Platform / billing / subscriptions / quotas — **never** owns creative meaning; Publication payloads stay free of billing/sponsor steering fields. Sponsorship remains Phase 2D post-film presentation only.
- Autonomous YouFlicks execution charter runs **through M7**. After M7 CLOSED, **STOP** — do not open M8 unless Brett extends. M8 is platform/billing only.

M7 only publishes (share/export). Keeping remains M6. Watching remains M5. Billing is out of scope.

---

## 9. Risks

1. **Collapsing Publication into FinishedMovie** — mitigate: D2/D4.  
2. **Silent auto-publish** — mitigate: D5.  
3. **Public CDN leak** — mitigate: D6 (no permanent unauth CDN; SHARE_LINK time-limited + revocable).  
4. **Vendor enum / social as domain truth** — mitigate: D3.  
5. **NLE / re-export for recipients** — mitigate: D6/D7/D11.  
6. **Secrets in payload** — mitigate: D8 (fingerprint only).  
7. **Creative AI job invent** — mitigate: D7/D9/D10.  
8. **Sponsor steering share targets** — mitigate: D7.  
9. **Charter creep into M8** — mitigate: §8 STOP after M7 CLOSED unless Brett extends.

---

## 10. Implementation sequence (when unlocked)

1. Keep this lock; no M8+ product work under M7. Do not mutate PHASE_2F–M6.  
2. Harden Publication schema (`movieId` required, +REVOKED, open-string `destinationKey`, payload rules).  
3. PublicationPort + PublicationService (DOWNLOAD + SHARE_LINK); `PUBLISH` when async remote (202).  
4. Share-token signing (expiry required, revoke); owner Export attachment stream.  
5. Minimal Share / Export UI; recipient watch-only player.  
6. Extend Playback (code only) with share-token auth for recipients.  
7. §6 tests → Architect implementation review → checkpoint.  
8. After M7 CLOSED: **STOP** (do not open M8 without Brett).

---

## 11. What M7 is

**M7 = Share / Export / Publication.**

It sits between M6 FinishedMovie / Library keep (`13881f3` / docs `d17a96b`) and M8 Platform / billing. It does **not** mean the film is billed, edited in an NLE, or redefined as a keep artifact. Keeping remains M6; watching remains M5; Publication is an explicit owner action that records a share or export attempt against exactly one READY FinishedMovie, with provider-neutral adapters and a time-limited revocable share link for watch-only recipients.

**Architect APPROVED this lock (2026-09-09).** Implementation CLOSED until CoS authorizes Engineer. Not implemented. Baseline checkpoint `13881f3`. Autonomous charter runs through M7 then **STOP**.

---

## Open questions

None requiring Brett hard-stop. D1–D12 follow established explicit-action + owned-artifact + provider-neutral port patterns (M3 Rebuild; M5/M6 StoragePort opacity; no creative AI for share/export). Escalation set **R = empty**. Soft-locks above close the set without inventing billing or NLE.

---

## Review & approval log

| Role | Action | Date | Result |
| --- | --- | --- | --- |
| CoS / Brett | Autonomous M7 architecture gate after M6 CLOSED (`13881f3`) | 2026-09-09 | **AUTHORIZED** (implementation CLOSED) |
| Architect | Draft + self-review `PHASE_M7_SHARE_EXPORT_ROADMAP_DECISION.md` | 2026-09-09 | **APPROVED** (autonomous mode; no Brett escalations — R set empty) |
| Architect | FINAL APPROVE | 2026-09-09 | **APPROVED** — binding soft-locks D1–D12 consistent with prior milestones |
| Chief of Staff | Engineer gate | — | **CLOSED** until CoS authorizes Engineer under this lock |
| Charter | Autonomous execution through M7 | 2026-09-09 | After M7 CLOSED → **STOP**; do not open M8 unless Brett extends |
