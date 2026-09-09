# YouFlicks Architecture

**Your footage. Your story. Your film.**

This document records the Phase 1 technical foundation: requirements analysis, architecture, technology choices, deferred work, roadmap, and MVP definition. It is the source of truth until the full product specification arrives.

---

## 1. Requirements analysis

YouFlicks turns a person’s photos, videos, memories, and ideas into a finished movie. The long-term product pipeline is:

```
User → Project → Media Assets → Media Analysis → AI Director
     → Story Structure → Timeline → Rendering → Finished Movie → Publishing
```

Phase 1 does **not** implement that pipeline. It establishes a production-quality web foundation that the pipeline can be built on without rewriting core boundaries.

### What Phase 1 must prove

- A real Next.js application, not a static mock.
- Typed configuration, database, and auth that actually run locally.
- Domain schema that already models the pipeline as data, even if most stages are unused.
- Ports (interfaces) for AI, storage, jobs, and rendering so later work plugs in instead of being bolted on.
- A cinematic product UI shell: marketing site, sign-in, dashboard, projects.

### Hard constraints from product direction

1. Build incrementally. No fake AI Director, fake renderer, or fake social graph.
2. **No AI provider is a default architectural dependency.** YouFlicks is capability-driven and provider-agnostic.
3. Keep AI, video processing, storage, and jobs behind ports. Adapters implement capabilities; they are not the domain.
4. Keep the database schema extensible. Persist YouFlicks-owned shapes, not vendor response types.
5. No mobile apps, no social platform, no full AI Director in this phase.
6. Ask before irreversible architecture bets. Reversible choices are documented below and proceeded with.

---

## 2. Proposed architecture

YouFlicks starts as a **modular monolith**: one Next.js application with a clear internal hexagonal layout. Microservices would be premature. Background work is modeled as jobs from day one so rendering and analysis can move to workers later without changing domain services.

```
┌─────────────────────────────────────────────────────────────┐
│                         Clients                              │
│              Web (Next.js App Router)                        │
│              Mobile / social  — deferred                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    Presentation                              │
│  app/(marketing)  app/(auth)  app/(app)  Route Handlers      │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                   Application services                       │
│     Auth  Projects  Media  (later: Story, Render)            │
└───────┬───────────┬───────────┬───────────┬─────────────────┘
        │           │           │           │
        ▼           ▼           ▼           ▼
   StoragePort   JobQueuePort  AiPort   RendererPort
        │           │           │           │
        ▼           ▼           ▼           ▼
   Local / S3   Postgres jobs  (none yet)  (none yet)
                            │
                    PostgreSQL + Prisma
```

### Layering

| Layer | Responsibility | Location |
| --- | --- | --- |
| Routes / UI | Pages, layouts, Server Actions | `src/app`, `src/components` |
| Application services | Use-cases, authorization checks | `src/server/services` (Projects, Media, Analysis, Director, Story, …) |
| Ports | Interfaces for IO and vendors | `src/server/ports` |
| Adapters | Concrete IO implementations | `src/server/adapters` |
| Persistence | Schema, Prisma client | `prisma`, `src/server/db` |
| Cross-cutting | Env, errors, logging | `src/lib` |

### Domain model (schema foundation)

These tables exist in Phase 1 so later features extend rows instead of inventing a new data model:

- **User** — account, profile, credentials
- **Project** — a film the user is making
- **MediaAsset** — uploaded or generated files (photo, video, audio, still)
- **MediaAnalysis** — provider-agnostic analysis results for an asset
- **CreativePlan** — versioned YouFlicks-owned Director output (meaning-level; Phase 2F)
- **StoryStructure** — versioned narrative StoryDocument derived from exactly one READY CreativePlan (M1)
- **Timeline / TimelineClip** — editorial structure used for rendering
- **RenderJob** — a request to produce a movie from a timeline
- **FinishedMovie** — a completed render
- **Publication** — an attempt to publish a movie somewhere
- **Job** — generic background work (analysis, direction, render, publish)

JSON columns hold provider-specific payloads. Enums are used only for *our* lifecycle states, not vendor names.

### Request path (example: create project)

1. Authenticated Server Action or Route Handler.
2. `ProjectService.create(userId, input)`.
3. Prisma write.
4. Structured log + typed error mapping.

Later, `ProjectService` will enqueue jobs through `JobQueuePort` without knowing whether the worker is in-process, Postgres-backed, or a dedicated fleet.

### Phase 2A — Media ingest

Uploads never talk to disk or S3 from the browser. The path is:

1. Authenticated `POST /api/projects/:id/assets` with one file.
2. `MediaService.ingest` checks project ownership.
3. MIME type is sniffed from magic bytes (`file-type`). Client `Content-Type` is ignored.
4. Bytes are written through `StoragePort.put` using an opaque key.
5. A `MediaAsset` row is created. Previews are a second object on the same port.
6. The UI reads files through `GET .../file`, which streams via `StoragePort.getStream` after the same ownership check.

The local filesystem adapter remains the development implementation. An S3/R2 adapter can replace it without changing `MediaService` or the UI.

### Capability-driven AI (locked)

This is a hard-to-reverse product rule. Later phases must follow it; they must not introduce a default vendor into the Director or core filmmaking services.

- **Capabilities, not vendors.** The domain asks for work such as “analyze footage,” “propose a story,” or “render a cut.” It does not import OpenAI, Anthropic, Runway, or any other SDK.
- **Providers are adapters.** Each vendor/model lives behind a port. Adding, removing, swapping, ranking, or routing providers must not require edits to the AI Director or to Project / Media / Story / Timeline / Render services.
- **Many adapters per capability.** The same capability can have multiple providers. A router (or ranked list) selects among them. No adapter is the architectural default.
- **Normalize at the boundary.** Adapter output is mapped into YouFlicks-owned schemas before it is stored or handed to the next pipeline stage. `providerKey` may be recorded for provenance. Vendor JSON must not become the `StoryStructure`, `MediaAnalysis`, or timeline contract.
- **No vendor enums in Prisma.** Provider identity stays a string key. Lifecycle enums are ours (`PENDING`, `READY`, …).

Phase 2B added the registry, normalizer, and owned analysis schema. Phase 2C registers one replaceable HTTP vision adapter behind the same contract. Phase 2E defines the AI Director as YouFlicks-owned creative intelligence. Phase 2F executes composition behind `AiDirectorPort` and persists CreativePlan. Models and providers are replaceable capabilities used by the Director, not the Director itself.

---

## 3. Technology choices

| Choice | Why |
| --- | --- |
| **Next.js (App Router) + TypeScript + React** | One codebase for marketing, app UI, and API. Server Components keep media-heavy pages lean. Matches the requested stack. |
| **Tailwind CSS + shadcn/ui** | Fast, consistent UI primitives without locking the product to a heavy component vendor. |
| **PostgreSQL + Prisma** | Relational model fits User/Project/Asset graphs. Prisma gives typed access and migrations. Postgres is the default operational store for jobs as well, delaying Redis. |
| **Better Auth** | Self-hosted auth with a first-class Prisma adapter and email/password. Auth.js v5 is still on a beta dist-tag; Better Auth 1.x is stable, keeps `User` in our database, and can add OAuth later without a rewrite. |
| **Object storage port + local adapter** | Uploads will be large. The port is S3-compatible in contract; local disk is the real Phase 1 adapter so development works offline. An S3 adapter can be added when credentials exist — not stubbed as a fake uploader. |
| **Job queue port + Postgres adapter** | Long-running AI/video work cannot live in HTTP requests. Jobs persist in Postgres (`Job` table) so we do not require Redis yet. The port lets us switch to BullMQ/SQS later. |
| **Zod env validation** | Fail fast on missing secrets. No scattered `process.env` reads. |
| **Docker Compose for Postgres** | Reproducible local database. The app itself stays a normal Next.js dev server. |
| **Structured JSON logging + typed `AppError`** | Production-shaped observability from the first request. |

### Decisions that are *not* locked

These are reversible and should be revisited before they become expensive:

- **Better Auth vs. a hosted IdP** — Better Auth is the default. Moving to Clerk/WorkOS later is possible because we own the `User` row.
- **Postgres jobs vs. BullMQ/Inngest** — hidden behind `JobQueuePort`.
- **Local/S3 storage vs. Cloudflare R2 / GCS** — hidden behind `StoragePort`.
- **Monolith vs. split worker service** — workers can extract by implementing the same ports in a second process.

### Decisions that *would* be hard to reverse

Raise these before changing them:

1. **PostgreSQL as system of record** — already requested; do not silently switch to Mongo/SQLite for production.
2. **Next.js as the web application** — already requested.
3. **Multi-tenant `User → Project` ownership model** — switching to workspace/org tenancy later is a migration, not a rewrite, if we add `Organization` rather than replacing `User`.
4. **Capability-driven, provider-agnostic AI** — no default AI vendor in the architecture. Do not put OpenAI/Anthropic/Runway types into Prisma enums, Director services, or filmmaking logic. Adapters normalize into YouFlicks-owned schemas. Providers for a capability may be added, removed, swapped, ranked, or routed without changing the Director.

---

## 4. Deferred on purpose

| Deferred | Why |
| --- | --- |
| Timeline / render / playback | M2 persists Timeline only. M3+ starts GeneratedAsset → Render. |
| Named commercial analysis SDKs | Adapters may speak HTTP. Domain code must not import a vendor SDK or vendor enum. |
| Cost-aware / ML provider routing | `ProviderSelectionPolicy` is replaceable. Phase 2C is deterministic. |
| Billing / usage accounting | Routing hints exist (`estimatedCost`, `estimatedLatency`, `qualityTier`). No charges. |
| Media transcoding / proxies | Ingest stores originals; analysis and render may transcode later. |
| Timeline editor | Complex NLE UI; M2 is review-only. |
| Rendering / FFmpeg / cloud render | Needs RendererPort implementation and workers. |
| Publishing destinations | Spec-dependent (YouTube, etc.). |
| Social platform | Explicitly out of scope. |
| Mobile apps | Explicitly out of scope; keep the web app responsive. |
| Advertising marketplace / ad delivery | Sponsor tables exist. No campaigns are served. No commercial ad provider. |
| Payments / subscription tiers | Sponsorship prefs exist. Nobody is charged. |
| Taste inference / ML | Signals can be recorded. Nothing is learned yet. |
| Billing / subscriptions | Not required to prove the foundation. |
| Redis, Kubernetes, multi-region | Premature. |
| Real S3/R2 adapter | Added when object-store credentials exist. Interface is ready. |
| OAuth (Google/Apple) | Auth foundation is email/password; providers are additive. |
| Email delivery | Sign-up is immediate; magic links later. |
| Broader UI/E2E suite | Phase 2A covers ingest/storage/ownership tests; expand with later stages. |

---

## 5. Implementation roadmap

### Phase 1 — Foundation

Scaffolding, TypeScript, UI kit, Prisma + Postgres, auth, layout, landing, dashboard/projects shells, env, service/port architecture, errors, logging, README.

### Phase 2A — Media ingest (this work)

Upload photos/videos on a project, store them through `StoragePort`, persist `MediaAsset` rows, show a media library with progress and per-file failure isolation. No analysis.

### Phase 2B — Media intelligence foundation

Provider-neutral analysis schemas, `ProviderRegistry`, `MediaAnalyzerPort`, job-backed analysis, persistence of `MediaAnalysis` rows, and project UI status. Not the AI Director.

External AI providers are replaceable adapters. The YouFlicks domain model does not depend on vendor-specific APIs or schemas.

```
Media Asset → Analysis Job → Adapter (via registry) → Normalization
          → YouFlicks analysis document → MediaAnalysis row
```

- **Owned document** (`analysisSchemaVersion: "1.0"`) covers technical, visual, people, audio, moments, quality, and duplicate foundations. Absent fields stay absent. Confidence is never invented.
- **`MediaAnalyzerPort.analyze`** returns that document plus provenance (`providerKey`, `modelId`, `modelVersion`). It never returns vendor SDK types.
- **`ProviderRegistry`** maps capabilities (`IMAGE_ANALYSIS`, `VIDEO_ANALYSIS`, `AUDIO_ANALYSIS`, `TRANSCRIPTION`, `VISION`, `EMBEDDINGS`) to zero or more adapters. Multiple adapters may advertise the same capability.
- **Normalization** (`normalizeAnalysisResult`) is the only path from adapter observations to persisted payload. Invalid observations are rejected.
- **Jobs** use the existing `JobQueuePort` (`MEDIA_ANALYZE`). HTTP enqueues and returns 202. A worker claims, analyzes, and persists. Jobs retry on unexpected failures (max 3). Typed `AppError`s fail the job immediately.
- **Re-analysis** inserts a new `MediaAnalysis` row. Previous rows are kept.
- **Provenance** is informational. The filmmaking domain must not switch on vendor names.

### Phase 2C — External analysis adapter

A real outbound analysis adapter that implements the existing contract. The domain still asks for a **capability**, not a vendor.

```
Analyze request
  → authorization
  → enqueue MEDIA_ANALYZE
  → worker
  → ProviderSelectionPolicy
  → ProviderRegistry
  → MediaAnalysisAdapter
  → normalized YouFlicks analysis
  → MediaAnalysis
  → status = ANALYZED
```

- **Configuration is adapter-local.** Optional env vars configure a preferred adapter key and one HTTP vision host (URL, key, model, timeout). Those values never enter Prisma or the filmmaking domain.
- **`HttpVisionAdapter`** (`providerKey` default `http.vision`) talks to any chat-completions host that accepts multimodal `image_url` parts. It is not a vendor SDK and is not referenced by Media, Analysis, Story, Timeline, or Render services.
- **Capabilities advertised by that adapter:** `IMAGE_ANALYSIS`, `VISION`, `VIDEO_ANALYSIS` (poster frame only). It does not claim `AUDIO_ANALYSIS`, `TRANSCRIPTION`, or `EMBEDDINGS`.
- **Disabled without credentials.** Missing URL, API key, or model leaves the adapter `configured=false` / `enabled=false`. Analyze throws a typed `PROVIDER_NOT_CONFIGURED` error. No fake AI results.
- **`ProviderSelectionPolicy`** is replaceable. Phase 2C ships `PreferredThenFirstPolicy`: ready adapters (`enabled && configured`) that advertise the capability; if `ANALYSIS_PROVIDER` matches one of them, use it; otherwise the first ready adapter. Later policies may rank quality, cost, latency, privacy, or health.
- **Storage isolation.** Adapters load bytes through `StoragePort` via `loadVisualObject`. They never open `./storage` or receive filesystem paths.
- **Normalization remains the domain contract.** Host JSON stays inside the adapter. Persistence stores the YouFlicks document plus provenance. Raw host responses are not saved and are not shown in the UI.
- **Observability.** Structured logs: `analysis.requested`, `analysis.queued`, `analysis.started`, `analysis.provider_selected`, `analysis.completed`, `analysis.failed`. Logs may include providerKey, capability, assetId, projectId, duration, status. They must not include API keys, authorization headers, raw host bodies, private media URLs, or session tokens.
- **Health.** `GET /api/health` reports each adapter as configured / enabled / available plus advertised capabilities. No secrets.
- **Routing hints** (`qualityTier`, `estimatedCost`, `estimatedLatency`) exist for a future selector. No billing.

#### Adding a future provider (no domain rewrite)

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

A new adapter implements `analyze()` + `health()`, advertises only the capabilities it can perform, and returns YouFlicks observations (or a shape the normalizer already accepts). Register it in `createAnalysisAdapters`. Do not add vendor columns to Prisma. Do not teach `AnalysisService` a vendor name.

### Phase 2D — Personalization, attribution & sponsorship foundation

Domain foundation only. No AI Director. No story. No timeline. No renderer. No payments. No advertising marketplace.

```
USER
 ↓
TASTE PROFILE
 ↓
PROJECT INTENT
 ↓
AI DIRECTOR          ← not implemented
 ↓
FILM
 ↓
PROVIDER ATTRIBUTION
 ↓
CREDITS BUILDER
 ↓
SPONSORSHIP ELIGIBILITY
 ↓
FILM CREDITS
 ↓
FUTURE RENDERER      ← not implemented
```

These are separate concerns:

| Concern | Owns | Must not own |
| --- | --- | --- |
| Taste | Subscriber identity and stated/inferred preference | Provider selection, sponsorship |
| Project intent | This film’s brief | Other films, sponsor copy |
| Provider selection | Which capability adapter runs | Taste, credits, ads |
| Attribution | Provenance of capability work | Vendor JSON, creative decisions |
| Credits | Display names and order | Rendering, story, footage |
| Sponsorship | Approved post-film presentation | Footage, story, Director, taste, timeline, render |

#### Taste

- `TasteProfile` (one per user) holds `TastePreference` (explicit) and `TasteSignal` (timestamped EXPLICIT or INFERRED).
- Dimension keys are open strings (`favorite_films`, `visual_style`, `what_matters`, …). New dimensions do not need a schema migration of enums.
- Explicit and inferred stay separate. “I love slow-burn films” is a preference. “They keep choosing longer cuts” is an inferred signal. No ML inference runs in this phase.

#### Project intent

- `ProjectCreativeIntent` is per project. When a field is set, it wins over taste for that film.
- Example: taste is cinematic and slow; the birthday project says funny and fast.

#### Attribution

- Successful analysis records `ProviderAttribution`: `providerKey`, `capability`, `modelId`, `modelVersion`, timestamp, project/asset/job/analysis ids.
- String keys only. No vendor columns. No raw host JSON.

#### Credits pipeline

- `CreditsService.buildForProject` is the Credits Builder. It does not import a renderer.
- Always credits YouFlicks, then distinct attribution providers, then (only if the subscriber opted in) approved sponsor credit lines.

#### Sponsorship isolation (locked)

Sponsors **must not** modify footage selection, story structure, the AI Director, user taste, the timeline, or rendering decisions.

Sponsors **may eventually** control approved credit presentation, approved end-card presentation, and approved advertisement placement — **only after the film itself is complete**.

Taste, footage, analysis, and personal identifiers are never sent to sponsors. Capability adapters receive an empty taste hint in this phase (`tasteHintForCapability` returns `{}`). They must never receive the full `TasteProfile`.

User sponsorship preferences default to **off**:

- `ALLOW_SPONSOR_CREDITS`
- `ALLOW_SPONSORED_END_CARD`
- `ALLOW_VIDEO_ADS`
- `ALLOW_PERSONALIZED_SPONSORING`

### Phase 2E — AI Director architecture (this work)

**The AI Director is YouFlicks-owned creative intelligence. Models and providers are replaceable capabilities used by the Director, not the Director itself.**

**User taste describes the user's longer-term preferences. Project intent describes what the user wants for a particular film. Project intent may override taste for that film without changing the underlying taste profile.**

**Sponsors may influence only approved post-film presentation and never creative decisions.**

This phase is the contract only. No story generation. No timeline. No renderer. No commercial Director adapter required yet. Composition and CreativePlan persistence arrive in Phase 2F.

```
USER
 ↓
TASTE PROFILE
 ↓
PROJECT CREATIVE INTENT
 ↓
NORMALIZED MEDIA UNDERSTANDING
 ↓
AI DIRECTOR
 ↓
CREATIVE PLAN
 ↓
FUTURE STORY
 ↓
FUTURE TIMELINE
 ↓
FUTURE RENDERER
```

Capability work stays a separate system. The Director asks; it does not pick a vendor:

```
CAPABILITY REQUEST
 ↓
PROVIDER REGISTRY
 ↓
PROVIDER SELECTION POLICY
 ↓
ADAPTER
 ↓
NORMALIZED RESULT
 ↓
AI DIRECTOR
```

After the film exists, presentation is a third system:

```
FILM
 ↓
PROVIDER ATTRIBUTION
 ↓
CREDITS
 ↓
SPONSORSHIP PRESENTATION
 ↓
FUTURE RENDERER
```

#### What the Director receives

`DirectorInput` is a minimized YouFlicks brief: project intent, a taste brief (explicit preferences + inferred signal *counts*, no payloads), effective brief (`PROJECT INTENT > GENERAL TASTE` on conflict), media inventory (no storage keys or URLs), normalized analysis documents, constraints, and capability availability (`available: boolean` — no `providerKey`).

It must not contain vendor JSON, API keys, sponsor records, user email/identity, or other projects.

`extras.ignoreGeneralTaste: true` on project intent lets the Director treat intent as dominant for that film. The taste profile is not rewritten.

#### What the Director produces

`CreativePlan` (`schemaVersion: "1.0"`) is the meaning-level bridge to story / timeline / render. Phase 2E validates the shape. Phase 2F persists it as a first-class artifact.

#### Iteration (not implemented)

```
USER → DIRECTOR → CREATIVE PLAN → FILM → USER FEEDBACK → TASTE SIGNAL → DIRECTOR → REVISED PLAN
```

Feedback may become an **inferred** `TasteSignal`. It must not become a `TastePreference` from a single film.

#### Memory (do not collapse)

User taste, project intent, taste signals, project decisions, film results, and user feedback stay separate types. There is no generic “AI memory” table.

#### Evaluation (boundary only)

The Director may later review a plan against intent, taste, media, constraints, coherence, pacing, and emotion. Phase 2E ships `createDirectorEvaluationBoundary` with `status: "NOT_IMPLEMENTED"`. No scores. No invented confidence.

#### Failure

Typed errors: `DIRECTOR_INPUT_INVALID`, `DIRECTOR_CAPABILITY_UNAVAILABLE`, `DIRECTOR_PLAN_INVALID`, `DIRECTOR_PROVIDER_UNAVAILABLE`, `DIRECTOR_CONSTRAINT_CONFLICT`. Missing capabilities fail clearly. No fake creative fallbacks.

### Phase 2F — Director execution & CreativePlan persistence

**Phase 2F = Director Execution → CreativePlan persistence.**

It executes the Phase 2E contract asynchronously and stops at a validated, versioned CreativePlan.

```
HTTP (owner) → enqueue AI_DIRECT (202 + jobId)
 ↓
DirectorWorker claims AI_DIRECT
 ↓
assemble DirectorInput (+ priorDecisions from previous READY plan)
 ↓
fingerprint input (persist hash only)
 ↓
AiDirectorPort.composePlan
 ↓
validate CreativePlan
 ↓
persist new CreativePlan version (prior READY → SUPERSEDED)
 ↓
record ProviderAttribution
```

Rules:

- Filmmaking core stays provider-neutral (`AiDirectorPort`). No vendor names in Director domain logic.
- CreativePlan is **not** stored in StoryStructure.
- Production Director availability requires a genuine configured adapter (`DIRECTOR_HTTP_*`). Local deterministic (`DIRECTOR_ALLOW_LOCAL` / tests) never advertises production availability and must not silently backfill production.
- Raw assembled Director input is not persisted — only `inputFingerprint`, `jobId`, and provenance fields.
- Minimal UI: compose, job status, view plan / failure. No chat, timeline editor, or render controls.

Authoritative specification: [PHASE_2F_ROADMAP_DECISION.md](./PHASE_2F_ROADMAP_DECISION.md).

### M1 — Story from plan

**M1 = CreativePlan → versioned StoryStructure.**

It executes a new provider-neutral port and stops at a validated, versioned StoryDocument:

```
HTTP (owner) → enqueue AI_STORY (202 + jobId)
 ↓
StoryWorker claims AI_STORY
 ↓
assemble StoryComposerInput from READY CreativePlan
  (+ privacy-minimized media inventory, intent/brief, optional prior READY story)
 ↓
fingerprint input (persist hash only)
 ↓
StoryComposerPort.composeStory
 ↓
validate StoryDocument (schema v1; reject timing / clip-list smuggling)
 ↓
persist new StoryStructure version (prior READY → SUPERSEDED)
 ↓
record ProviderAttribution (outside the port return)
```

Rules:

- Do **not** extend or overload `AiDirectorPort`. Story composition is `StoryComposerPort` only.
- StoryStructure is **not** a renamed CreativePlan. It owns narrative structure, not editorial execution.
- `targetDurationMs` is optional on acts only and must never become `startMs` / `endMs`.
- In-progress belongs on Job (`PENDING` | `RUNNING` | …). StoryStructure status is only `DRAFT` | `READY` | `SUPERSEDED` | `FAILED`.
- Production story availability requires a genuine configured adapter (`STORY_HTTP_*`). Local deterministic (`STORY_ALLOW_LOCAL` / tests) never advertises production availability.
- Minimal UI: “Your story”, Build / Rebuild, status, readable outline, version history. No timeline editor, Director chat, or Generate Film.

Authoritative specification: [PHASE_M1_STORY_ROADMAP_DECISION.md](./PHASE_M1_STORY_ROADMAP_DECISION.md).

### M2 — Cut from story

**M2 = StoryStructure → versioned executable Timeline.**

It executes a new provider-neutral port and stops at a validated, versioned TimelineDocument:

```
HTTP (owner) → enqueue AI_TIMELINE (202 + jobId)
 ↓
TimelineWorker claims AI_TIMELINE
 ↓
assemble TimelineComposerInput from READY StoryStructure
  (+ privacy-minimized media inventory, intent/brief, optional prior READY timeline)
 ↓
fingerprint input (persist hash only)
 ↓
TimelineComposerPort.composeTimeline
 ↓
validate TimelineDocument (schema v1; MediaAsset-only clips; unmetMediaRoles for gaps)
 ↓
persist new Timeline version + TimelineClip rows (prior READY → SUPERSEDED)
 ↓
record ProviderAttribution (outside the port return)
```

Rules:

- Do **not** extend or overload `AiDirectorPort` or `StoryComposerPort`. Cut composition is `TimelineComposerPort` only.
- Timeline is **not** a renamed StoryStructure. It owns editorial execution (clips, tracks, absolute timings).
- Timing (`timelineStartMs` / `timelineEndMs`, source in/out) is legal only on Timeline / TimelineClip.
- Place only existing `MediaAsset` rows. Unmet story `mediaRoles` are `unmetMediaRoles` for M3 — no GeneratedAsset IDs, no null-asset clips.
- In-progress belongs on Job (`PENDING` | `RUNNING` | …). Timeline status is only `DRAFT` | `READY` | `SUPERSEDED` | `FAILED`.
- Production timeline availability requires a genuine configured adapter (`TIMELINE_HTTP_*`). Local deterministic (`TIMELINE_ALLOW_LOCAL` / tests) never advertises production availability.
- Minimal UI: “Your cut”, Build / Rebuild, status, read-only ordered shot list with simple times. No NLE, Director chat, or Generate Film.

Authoritative specification: [PHASE_M2_TIMELINE_ROADMAP_DECISION.md](./PHASE_M2_TIMELINE_ROADMAP_DECISION.md).

### M3+ — Generated assets, render, playback (not this milestone)

**`Timeline → assets → Render → Playback → FinishedMovie`**

M3 (future lock) fills unmet media roles. Rendering, playback, and FinishedMovie remain later milestones. Do not leak those concepts backward into CreativePlan, StoryDocument, or TimelineDocument.

### Phase 4 — Render & movie

RendererPort implementation (local FFmpeg first), render jobs, FinishedMovie records, playback of completed films.

### Phase 5 — Publish & harden

Publication records, one real destination, production object storage, worker process extraction, observability, billing if needed.

### Phase 6+ — Deferred products

Mobile, social, collaboration, multi-user orgs — only after the filmmaking loop works.

---

## 6. Minimum viable product

The first *product* MVP is **not** Phase 1. Phase 1 is the platform floor.

**MVP (target of Phases 2–4):** a signed-in user can create a project, add their own footage, receive a story structure, review a timeline, and download a rendered movie.

Anything that does not serve that loop (social, mobile, multi-provider marketplace, public profiles) waits.

Phase 2E exit criteria:

- [x] Provider-neutral `DirectorInput` and `CreativePlan` contracts
- [x] Director requests capabilities; registry/policy select adapters
- [x] Project intent overrides conflicting taste without rewriting taste
- [x] Explicit vs inferred taste remain distinct in Director input
- [x] Sponsor data cannot enter Director input
- [x] No Director chat UI or Generate Film control
- [x] Composition deferred to Phase 2F (contract only in 2E)

Phase 2F exit criteria:

- [x] First-class versioned `CreativePlan` persistence with provenance
- [x] `DirectorService` + `AI_DIRECT` enqueue/worker path
- [x] HTTP returns 202; composition runs off-request
- [x] Recompose from previous READY plan `priorDecisions`
- [x] Production vs local Director availability honesty
- [x] No StoryStructure / Timeline / Render writes

M1 exit criteria:

- [x] First-class versioned `StoryStructure` persistence with provenance to one READY CreativePlan
- [x] `StoryService` + `AI_STORY` enqueue/worker path
- [x] HTTP returns 202; composition runs off-request
- [x] Recompose from previous READY StoryDocument
- [x] Production vs local story availability honesty
- [x] No Timeline / Render / FinishedMovie / Publication writes

M2 exit criteria:

- [x] First-class versioned `Timeline` persistence with provenance to one READY StoryStructure
- [x] `TimelineService` + `AI_TIMELINE` enqueue/worker path
- [x] HTTP returns 202; composition runs off-request
- [x] Rebuild from previous READY TimelineDocument
- [x] Production vs local timeline availability honesty
- [x] Review-only UI only (no NLE)
- [x] No RenderJob / FinishedMovie / Publication / GeneratedAsset writes

Phase 2D exit criteria:

- [x] TasteProfile / TastePreference / TasteSignal with explicit vs inferred
- [x] ProjectCreativeIntent that overrides taste
- [x] ProviderAttribution written on analysis completion
- [x] FilmCredits + Credits Builder (no renderer)
- [x] Sponsor / Campaign / Offer / Placement foundation
- [x] Sponsorship cannot touch creative decisions or private taste/media
- [x] User sponsorship preferences default off
- [x] Authenticated taste, intent, attribution, and credits APIs
- [x] Simple Taste and project-intent UI

Phase 2C exit criteria:

- [x] Provider-neutral analysis configuration (env only; no Prisma vendor fields)
- [x] One real external analysis adapter behind `MediaAnalysisAdapter`
- [x] Capability-based registry lookup and replaceable `ProviderSelectionPolicy`
- [x] Media loaded through `StoragePort`, never filesystem paths
- [x] Normalized YouFlicks document persisted; raw host JSON not stored or shown
- [x] Structured analysis logs without secrets
- [x] Provider status on `/api/health`
- [x] Media library shows analysis state and existing normalized fields only

Phase 2B exit criteria:

- [x] Versioned YouFlicks-owned analysis schema
- [x] Provider-neutral `MediaAnalyzerPort` and adapter contract
- [x] Capability registry
- [x] Job-backed analysis that does not block HTTP
- [x] Persistence of normalized `MediaAnalysis` with provenance
- [x] Re-analysis keeps prior rows
- [x] Project UI shows analysis state and normalized results

Phase 2A exit criteria:

- [x] Authenticated upload of photos/videos on a project
- [x] Bytes stored only through `StoragePort`
- [x] `MediaAsset` rows with filename, MIME (sniffed), size, keys, dimensions, duration, status
- [x] Media library with progress, multi-file ingest, per-file failure, and delete
- [x] Owner-only file access; no storage credentials in the browser

Phase 1 exit criteria:

- [x] App runs locally with documented env vars
- [x] Postgres schema migrates
- [x] User can register, sign in, and reach the dashboard
- [x] Landing, dashboard, and projects routes exist
- [x] Ports defined for storage, jobs, AI, rendering
- [x] No fake film generation

---

## 7. Repository map

```
src/app/(marketing)     Landing
src/app/(auth)          Sign in / sign up
src/app/(app)           Authenticated shell (dashboard, projects, taste)
src/app/api             Auth, health, media, analysis, taste, intent, credits
src/components          UI, layout, media library, taste, intent
src/lib                 env, errors, logger (no I/O)
src/server/db           Prisma client
src/server/media        MIME sniffing, size limits, previews
src/server/analysis     Owned schemas, normalizer, registry, selection
src/server/personalization  Taste brief, privacy boundary
src/server/director     Director input, plan schema, capability gateway, fingerprint
src/server/story        StoryDocument schema, input, validation, availability
src/server/timeline     TimelineDocument schema, input, validation, availability
src/server/ports        Interfaces
src/server/adapters     Local storage, Postgres jobs, analysis + Director + story + timeline adapters
src/server/services     Project, Media, Analysis, Director, Story, Timeline, Taste, Intent, Credits
prisma/schema.prisma    Extensible domain schema
docker-compose.yml      Local Postgres
```
