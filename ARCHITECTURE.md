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
2. Do not hard-code a single AI vendor.
3. Keep AI, video processing, storage, and jobs behind abstractions.
4. Keep the database schema extensible.
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
│         Auth  Projects  (later: Media, Story, Render)        │
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
| Application services | Use-cases, authorization checks | `src/server/services` |
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
- **StoryStructure** — AI Director output (acts, scenes, narrative intent)
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
4. **Not binding the domain to one AI vendor** — do not put OpenAI/Anthropic/Runway types into Prisma enums.

---

## 4. Deferred on purpose

| Deferred | Why |
| --- | --- |
| Full AI Director | Product spec not in this phase; would force a vendor choice. Port exists; no implementation. |
| Media upload pipeline, transcoding, analysis | Needs storage + jobs + UI; Phase 2. |
| Timeline editor | Complex UI; depends on story structure. |
| Rendering / FFmpeg / cloud render | Needs RendererPort implementation and workers. |
| Publishing destinations | Spec-dependent (YouTube, etc.). |
| Social platform | Explicitly out of scope. |
| Mobile apps | Explicitly out of scope; keep the web app responsive. |
| Billing / subscriptions | Not required to prove the foundation. |
| Redis, Kubernetes, multi-region | Premature. |
| Real S3/R2 adapter | Added when object-store credentials exist. Interface is ready. |
| OAuth (Google/Apple) | Auth foundation is email/password; providers are additive. |
| Email delivery | Sign-up is immediate; magic links later. |
| Test suite beyond typecheck | Phase 1 is scaffolding; tests grow with domain services. |

---

## 5. Implementation roadmap

### Phase 1 — Foundation (this work)

Scaffolding, TypeScript, UI kit, Prisma + Postgres, auth, layout, landing, dashboard/projects shells, env, service/port architecture, errors, logging, README.

### Phase 2 — Media & projects

Real project CRUD, media upload through `StoragePort`, asset listing, background job enqueue for analysis, first analysis adapter behind `MediaAnalyzerPort`.

### Phase 3 — Story & timeline

StoryStructure persistence, a first AI Director adapter behind `AiDirectorPort`, timeline generation from story + assets, timeline review UI (not a full NLE).

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
src/app/(app)           Authenticated shell (dashboard, projects)
src/app/api             Auth + health
src/components          UI and layout
src/lib                 env, errors, logger (no I/O)
src/server/db           Prisma client
src/server/ports        Interfaces
src/server/adapters     Real adapters (local storage, postgres jobs)
src/server/services     Application services
prisma/schema.prisma    Extensible domain schema
docker-compose.yml      Local Postgres
```
