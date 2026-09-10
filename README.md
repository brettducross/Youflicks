# YouFlicks

**Your footage. Your story. Your film.**

YouFlicks is an AI-powered filmmaking platform that turns a person’s photos, videos, memories, and ideas into a finished movie.

This repository currently includes **Phase 1** through **M7** (Share / Export / Publication of a READY kept film). It does not take payments or serve ads.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the analysis, technology choices, deferred work, roadmap, and MVP definition.

## What is built

- Next.js 16 App Router, TypeScript, Tailwind CSS, shadcn/ui
- PostgreSQL + Prisma 7
- Better Auth (email/password)
- Landing page, dashboard, and projects
- Media ingest: upload photos/videos into a project, store them through `StoragePort`, list and remove them in a media library
- Media intelligence: enqueue analysis jobs, select an adapter by capability, normalize results into a YouFlicks-owned schema, persist `MediaAnalysis` with provenance, and record provider attribution
- Taste profile, project creative intent, film credits, and sponsorship **foundation** (no marketplace, no ads served)
- AI Director **execution (Phase 2F)**: enqueue `AI_DIRECT`, compose through `AiDirectorPort`, validate, and persist a versioned YouFlicks-owned `CreativePlan`
- **M1 story from plan**: enqueue `AI_STORY`, compose through `StoryComposerPort`, validate, and persist a versioned YouFlicks-owned `StoryStructure` / `StoryDocument` (not a timeline or render)
- **M2 cut from story**: enqueue `AI_TIMELINE`, compose through `TimelineComposerPort`, validate, and persist a versioned YouFlicks-owned `Timeline` / `TimelineDocument` plus `TimelineClip` rows (review-only; not an NLE, render, or GeneratedAsset)
- **M3 missing pieces**: enqueue `AI_ASSET`, generate through `AssetGeneratorPort`, and persist `GeneratedAsset` rows distinct from `MediaAsset`
- **M4 render**: enqueue `RENDER`, assemble a YouFlicks-owned `RenderManifest`, render through `RendererPort`, and persist `RenderJob` + opaque StoragePort output (not FinishedMovie, not playback)
- **M5 playback**: open an ephemeral watch session through `PlaybackPort`, stream a SUCCEEDED render’s opaque StoragePort key to the owner (not a library keep, not share)
- **M6 library keep**: explicit Keep copies a SUCCEEDED render into a durable `FinishedMovie` library artifact through `MovieService` + StoragePort (not share, not Publication)
- **M7 share / export**: explicit Export (owner attachment) and Share link (time-limited revocable watch-only token) through `PublicationService` + `PublicationPort` against exactly one READY FinishedMovie
- Extensible domain schema: User → Project → Media → Analysis → CreativePlan → Story → Timeline → Render → Movie → Publish
- Ports for object storage, background jobs, AI Director, story composer, timeline composer, asset generator, media analysis, rendering, and playback
- Local filesystem storage adapter (swap later for S3/R2 behind the same port)
- Structured JSON logging and typed `AppError`s

## What is intentionally not built

- Treating a share link as a public CDN or a second library keep
- Treating the local/deterministic story, timeline, asset, or renderer adapters as production
- Named vendor SDKs in the domain
- Billing, payments, subscriptions, or an advertising marketplace (M8)
- UFlix Global / social publishing destinations (optional later adapters)
- Social features
- Mobile apps
- Treating the local/deterministic Director as production AI

## Prerequisites

- Node.js 20.19+ (22 is fine)
- PostgreSQL 16, either:
  - Docker: `docker compose up -d`
  - or a local Postgres with a `youflicks` database
- FFmpeg / ffprobe on `PATH` for video posters and duration (optional; photos still ingest without it)

## Run locally

```bash
cp .env.example .env
# Set BETTER_AUTH_SECRET to a long random string:
#   openssl rand -base64 32
# Set BETTER_AUTH_URL to the URL you will open in the browser.

docker compose up -d   # skip if Postgres is already running

npm install
npx prisma migrate deploy
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | App on port 43147 |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript |
| `npm run test` | Ingest, analysis, storage, and validation tests |
| `npm run lint` | ESLint |
| `npm run db:studio` | Prisma Studio |
| `GET /api/health` | App, database, and analysis-provider status (no secrets) |

## Try media ingest

1. Sign in and create a project.
2. Open the project.
3. Drop JPEG, PNG, WEBP, HEIC, MP4, MOV, or WEBM files onto the camera roll.
4. Watch per-file progress. One failed file does not cancel the rest.
5. Click a still or clip to inspect it. Remove it with the trash control.

Uploads go to `POST /api/projects/:projectId/assets`. Files are stored through `StoragePort` using opaque keys such as `projects/{projectId}/assets/{assetId}/original.jpg`. The browser never receives storage credentials or filesystem paths. MIME type is sniffed from magic bytes; the client `Content-Type` is ignored.

Default size limits (override in `.env`):

- Photos: 40 MB (`MEDIA_MAX_IMAGE_BYTES`)
- Videos: 512 MB (`MEDIA_MAX_VIDEO_BYTES`)

## Environment variables

See `.env.example`. Required:

- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — session signing secret (16+ characters)
- `BETTER_AUTH_URL` — public origin of the app
- `STORAGE_DRIVER` — `local` until an S3 adapter is added
- `STORAGE_LOCAL_PATH` — directory for the local storage adapter
- `LOG_LEVEL` — `debug` \| `info` \| `warn` \| `error`
- `MEDIA_MAX_IMAGE_BYTES` / `MEDIA_MAX_VIDEO_BYTES` — ingest caps
- `ANALYSIS_PROVIDER` — optional preferred adapter key. Leave empty to use the first ready adapter for the requested capability.
- `ANALYSIS_HTTP_PROVIDER_KEY` — provenance key for the HTTP vision adapter (default `http.vision`)
- `ANALYSIS_HTTP_BASE_URL` / `ANALYSIS_HTTP_API_KEY` / `ANALYSIS_HTTP_MODEL` — HTTP vision host. The adapter stays disabled until all three are set.
- `ANALYSIS_HTTP_TIMEOUT_MS` — outbound analysis timeout (default `45000`)
- `ASSET_HTTP_PROVIDER_KEY` — open provenance string for the HTTP asset adapter (default `http.asset`)
- `ASSET_HTTP_BASE_URL` / `ASSET_HTTP_API_KEY` / `ASSET_HTTP_MODEL` — YouFlicks `/v1/generate` gateway. Disabled until all three are set. The app does **not** take a fal key.
- `ASSET_HTTP_CAPABILITIES` — honest YouFlicks capability list. R1: `VIDEO_GENERATION`. Empty also means video only.
- `ASSET_HTTP_TIMEOUT_MS` — outbound generate timeout (use `300000` for video)

Provider secrets belong in environment variables only. Do not put them in Prisma, source, or the browser.

### R1 video HTTP gateway

First real `VIDEO_GENERATION` path is adapter-only: the app calls existing `HttpAssetGeneratorAdapter` → a separate YouFlicks-shaped gateway (`npm run gateway:asset`) → a config-backed video queue. fal queue+webhooks is the default **example**. `YF_GATEWAY_BACKEND=replicate` is an **alternate** transport (authenticated `files.create` + open-string I2V such as Wan) — not a permanent domain default.

```bash
# Terminal 1 — gateway (vendor key stays here)
YF_GATEWAY_API_KEY="shared-gateway-key" \
YF_GATEWAY_BACKEND="fal" \
YF_GATEWAY_BACKEND_API_KEY="your-fal-key" \
YF_GATEWAY_MODEL="fal-ai/ltx-video" \
YF_GATEWAY_MAX_JOBS="10" \
YF_GATEWAY_MAX_SPEND_USD="5" \
npm run gateway:asset

# App .env — no vendor SDK, open providerKey + model strings
ASSET_HTTP_BASE_URL="http://127.0.0.1:43148"
ASSET_HTTP_API_KEY="shared-gateway-key"
ASSET_HTTP_MODEL="fal-ai/ltx-video"
ASSET_HTTP_CAPABILITIES="VIDEO_GENERATION"
ASSET_HTTP_TIMEOUT_MS="300000"
```

Swap the model or point the gateway at fal, Replicate, or another HTTP queue with env only. See [docs/R1_VIDEO_HTTP_GATEWAY.md](./docs/R1_VIDEO_HTTP_GATEWAY.md). This does not claim an E2E movie without keys. R2 local FFmpeg (ingest posters / duration, optional local renderer) is unchanged.

## Project layout

```
src/app/(marketing)     Landing
src/app/(auth)          Sign in / sign up
src/app/(app)           Authenticated studio
src/app/api             Auth, health, media ingest
src/components          UI, layout, media library
src/lib                 env, errors, logger, auth
src/server/db           Prisma client
src/server/media        MIME sniffing, size limits, previews
src/server/analysis     Owned schemas, normalizer, registry, selection
src/server/personalization  Taste brief and privacy rules
src/server/director     Director contract (input, plan, capabilities)
src/server/story        StoryDocument schema, input, validation, availability
src/server/timeline     TimelineDocument schema, input, validation, availability
src/server/movie        FinishedMovie library keep (privacy, fingerprint, opaque keys)
src/server/publication  Publication share/export (tokens, privacy, destination keys)
src/server/ports        Storage, jobs, AI, story composer, timeline composer, renderer, playback, publication, analyzer interfaces
src/server/adapters     Local storage, Postgres jobs, analysis / Director / story / timeline / renderer / playback / publication adapters
src/server/gateways     Separate YouFlicks-shaped HTTP workers (R1 video /v1/generate)
src/server/services     Project, Media, Analysis, Taste, Intent, Credits, Director, Story, Timeline, Render, Playback, Movie, Publication
prisma/schema.prisma    Domain schema
```

## Try media analysis

1. Open a project that already has footage.
2. Click a still or clip, then **Analyze**.
3. The card shows Not analyzed / Queued / Analyzing / Analyzed / Analysis failed.
4. Open the clip again to see normalized notes that actually exist (technical, scene, objects, quality, and so on). Raw host JSON is never stored or shown.

`POST /api/projects/:projectId/assets/:assetId/analyze` returns `202` and enqueues a `MEDIA_ANALYZE` job. The HTTP request does not wait for analysis.

Two adapters are registered:

- `youflicks.local.technical` — first-party metadata copier. Always available. Not an AI vendor.
- `http.vision` — optional HTTP vision adapter. Disabled until `ANALYSIS_HTTP_BASE_URL`, `ANALYSIS_HTTP_API_KEY`, and `ANALYSIS_HTTP_MODEL` are set. Set `ANALYSIS_PROVIDER` to that adapter’s key to prefer it when it is ready.

Re-analyze keeps previous `MediaAnalysis` rows.

### Capability routing

The domain asks for a capability such as `IMAGE_ANALYSIS` or `VIDEO_ANALYSIS`. `ProviderRegistry` lists adapters that advertise that capability. `PreferredThenFirstPolicy` picks a ready adapter: the preferred key if eligible, otherwise the first ready match. A later policy can replace this without changing Analysis, Media, or the (future) AI Director.

### Adding another analysis provider

```
NewProviderAdapter implements MediaAnalysisAdapter
        ↓
register adapter
        ↓
advertise capabilities
        ↓
selection policy may choose it
        ↓
existing analysis pipeline remains unchanged
```

Do not add vendor columns to Prisma. Do not teach domain services a vendor name. Normalize host output inside the adapter / normalizer boundary.

## Current limitations

- Uploads are buffered in the Next.js process. They are not chunked or resumable.
- HEIC/HEIF is accepted when magic bytes match; a thumbnail is generated only if libvips/sharp can decode the file.
- Video posters and duration need FFmpeg/ffprobe. Ingest still succeeds without them; the library shows a film glyph until a preview exists.
- The storage adapter is local disk. An S3/R2 adapter can be added behind `StoragePort` without changing MediaService or the UI.
- The HTTP vision adapter needs a stored poster for video. It does not transcribe audio or produce embeddings.
- Without HTTP credentials, analysis still succeeds through the local technical adapter (technical metadata only).
- Production Director availability requires a configured Director HTTP adapter (`DIRECTOR_HTTP_*`). Local technical analysis does **not** count as Director availability.
- `DIRECTOR_ALLOW_LOCAL=true` enables the deterministic local Director for development/tests only. It never advertises production availability.
- Rendering, watch, explicit library keep, and explicit share/export are implemented. Billing is not.
- Production story availability requires a configured story HTTP adapter (`STORY_HTTP_*`). Local deterministic composition does **not** count as production story availability.
- `STORY_ALLOW_LOCAL=true` enables the deterministic local story composer for development/tests only. It never advertises production availability.
- Production timeline availability requires a configured timeline HTTP adapter (`TIMELINE_HTTP_*`). Local deterministic composition does **not** count as production timeline availability.
- `TIMELINE_ALLOW_LOCAL=true` enables the deterministic local timeline composer for development/tests only. It never advertises production availability.
- Production `VIDEO_GENERATION` requires `ASSET_HTTP_*` pointed at the YouFlicks asset gateway plus a backend key on that gateway process. Without those, missing pieces stay local-only (`ASSET_ALLOW_LOCAL`) or unavailable. Voice / music / SFX are not production HTTP capabilities in R1.

## Taste and project intent (Phase 2D)

Open **Taste** in the studio nav. Answer a few questions. That profile stays on your account.

On a project, use **Creative intent** when this film should feel different from your usual taste. Project intent wins.

Successful analysis writes provider attribution. `POST /api/projects/:projectId/credits` builds a credits preview from YouFlicks + attribution (+ approved sponsor lines only if you opted in). Nothing is rendered into a video.

Sponsors cannot read taste, footage, or analysis. They cannot change the story, timeline, or Director decisions.

## AI Director contract (Phase 2E)

The Director is YouFlicks-owned creative intelligence. Providers are capabilities it may request. There is no Generate Film button, no Director chat, and no story output.

Taste (Taste page) and project Creative intent remain the user-facing inputs. Project intent wins when it conflicts with long-term taste. That does not rewrite the taste profile.

## Director execution (Phase 2F)

Phase 2F runs the 2E contract asynchronously:

`API → enqueue AI_DIRECT → worker → AiDirectorPort.composePlan → validate → persist CreativePlan`

- Owner-only compose returns **202** with `jobId` (no inline AI).
- CreativePlan is a first-class, versioned artifact with `jobId`, input fingerprint, and provider provenance.
- Recomposition reads `priorDecisions` from the previous READY CreativePlan.
- Production availability requires a genuine configured Director adapter. Local deterministic is test/dev only.

See [PHASE_2F_ROADMAP_DECISION.md](./PHASE_2F_ROADMAP_DECISION.md).

## Story from plan (M1)

M1 turns a READY CreativePlan into a versioned narrative StoryStructure:

`API → enqueue AI_STORY → worker → StoryComposerPort.composeStory → validate → persist StoryStructure`

- Owner-only compose returns **202** with `jobId` (no inline AI).
- StoryDocument is narrative-only (acts / scenes / beats / media **roles**). `targetDurationMs` is optional on acts only and is never editorial timing.
- Recomposition reads the previous READY StoryDocument for continuity. No chat. No Timeline reads.
- Production availability requires a genuine configured story adapter. Local deterministic is test/dev only.

See [PHASE_M1_STORY_ROADMAP_DECISION.md](./PHASE_M1_STORY_ROADMAP_DECISION.md).

## Cut from story (M2)

M2 turns a READY StoryStructure into a versioned executable Timeline:

`API → enqueue AI_TIMELINE → worker → TimelineComposerPort.composeTimeline → validate → persist Timeline + TimelineClip`

- Owner-only compose returns **202** with `jobId` (no inline AI).
- TimelineDocument is editorial-only (tracks / clips / absolute timings). Timing is illegal on CreativePlan and StoryDocument.
- Placed clips reference existing `MediaAsset` rows only. Unmet story `mediaRoles` are recorded as `unmetMediaRoles` for M3 — never GeneratedAsset IDs or null-asset slots.
- Rebuild reads the previous READY TimelineDocument for continuity. No chat. No NLE.
- Review-only UI: “Your cut”, Build / Rebuild, status, read-only ordered shot list with simple times.
- Production availability requires a genuine configured timeline adapter. Local deterministic is test/dev only.

See [PHASE_M2_TIMELINE_ROADMAP_DECISION.md](./PHASE_M2_TIMELINE_ROADMAP_DECISION.md).

## Missing pieces (M3)

M3 turns READY Timeline `unmetMediaRoles` into generated/processed assets:

`API → enqueue AI_ASSET → worker → AssetGeneratorPort.generate → validate → persist GeneratedAsset`

R1 production video uses the HTTP adapter + a separate YouFlicks `/v1/generate` gateway. See [docs/R1_VIDEO_HTTP_GATEWAY.md](./docs/R1_VIDEO_HTTP_GATEWAY.md).

See [PHASE_M3_GENERATED_ASSETS_ROADMAP_DECISION.md](./PHASE_M3_GENERATED_ASSETS_ROADMAP_DECISION.md).

## Render (M4)

M4 turns a READY Timeline into a validated render output:

`API → enqueue RENDER → worker → assemble RenderManifest → RendererPort.render → persist RenderJob SUCCEEDED + StoragePort bytes`

- Owner-only render returns **202** with `jobId` (no inline render).
- `RenderManifest` is YouFlicks-owned schema v1 (clips, timings, opaque storage keys, `WEB_720 | WEB_1080 | MASTER`). Not FFmpeg graphs or vendor job JSON.
- Clip sources are `MEDIA_ASSET` and/or `GENERATED_ASSET`, resolved through StoragePort. A READY cut may render even if some story roles remain unfilled.
- Successful render stops at `RenderJob` + output bytes. It does **not** create a FinishedMovie, Publication, or playback player.
- Review-only UI: “Your movie”, Render, status, then Watch on success.
- Production availability requires a genuine configured renderer. Local deterministic is test/dev only.

See [PHASE_M4_RENDER_ROADMAP_DECISION.md](./PHASE_M4_RENDER_ROADMAP_DECISION.md).

## Playback (M5)

M5 lets the project owner watch a successful render:

`API → PlaybackService.open → PlaybackPort → owner-auth StoragePort stream → close`

- Owner-only `POST .../playback/open` returns an ephemeral session (not a library keep).
- `GET .../playback/sessions/:sessionId/stream` ranges bytes from the SUCCEEDED RenderJob `outputKey`.
- `POST .../playback/close` ends the session. Sessions are short-lived signed tokens, not Prisma rows.
- Web uses `WebMediaPlaybackAdapter` (`APP_STREAM`). VLC/libVLC is `VlcPlaybackAdapter` only — never a Prisma column or domain type.
- Job type is not invented: there is no `AI_PLAYBACK`.
- Minimal UI: Watch on “Your movie”, play / pause / seek / time. Keep this film is a separate M6 action.

See [PHASE_M5_PLAYBACK_ROADMAP_DECISION.md](./PHASE_M5_PLAYBACK_ROADMAP_DECISION.md).

## Library keep (M6)

M6 lets the project owner explicitly keep a successful render:

`API → MovieService.keep → StoragePort copy → FinishedMovie READY`

- Owner-only `POST .../movies/keep` returns the kept film (**200**) or `{ jobId, status: ACCEPTED }` (**202**) when copy is async (`LIBRARY_KEEP`).
- Keep is never automatic on render success or watch open.
- Bytes are copied into `projects/{projectId}/movies/{movieId}/…`. FinishedMovie is not a thin pointer to render output.
- `GET .../movies` lists kept films. `POST .../movies/:id/archive` soft-archives (no immediate byte delete).
- Watch a kept film with `POST .../playback/open` `{ finishedMovieId }` — same PlaybackPort session pattern as M5.
- Minimal UI: “Keep this film”, Library list, Watch, Archive. Share / Export is a separate M7 action.
- Job type is `LIBRARY_KEEP` only. There is no `AI_LIBRARY` or `AI_MOVIE`.

See [PHASE_M6_FINISHED_MOVIE_ROADMAP_DECISION.md](./PHASE_M6_FINISHED_MOVIE_ROADMAP_DECISION.md).

## Share / export (M7)

M7 lets the project owner explicitly export or share a READY kept film:

`API → PublicationService → PublicationPort (DOWNLOAD | SHARE_LINK) → Publication`

- Owner-only `POST .../movies/:id/export` streams an attachment (`Content-Disposition: attachment`) and records a `DOWNLOAD` Publication (**200**), or returns `{ jobId, status: ACCEPTED }` (**202**) when `PUBLISH` is async.
- Owner-only `POST .../movies/:id/share-link` creates a time-limited, revocable watch-only token. Payload stores `expiresAt` + `tokenFingerprint` — never the raw token.
- `GET .../movies/:id/publications` lists status. `POST .../publications/:id/revoke` sets `REVOKED`.
- Recipients watch at `/watch/{token}` through Playback share-token auth. No project APIs, Keep, or re-export.
- Permanent unauthenticated public CDN of library bytes is forbidden.
- Job type is `PUBLISH` only. There is no `AI_PUBLISH` or `AI_SHARE`.
- Honesty flags: `canExport` / `canShareLink`. Missing destinations fail as unavailable.

See [PHASE_M7_SHARE_EXPORT_ROADMAP_DECISION.md](./PHASE_M7_SHARE_EXPORT_ROADMAP_DECISION.md).

## Next phase

M8 pipeline (not implemented):

`Platform / billing`

Do not implement billing or subscriptions until that milestone is requested. After M7 CLOSED the autonomous charter **STOP**s unless Brett extends.
