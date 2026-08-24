# YouFlicks

**Your footage. Your story. Your film.**

YouFlicks is an AI-powered filmmaking platform that turns a person’s photos, videos, memories, and ideas into a finished movie.

This repository is the **Phase 1 foundation**: a real Next.js studio you can run locally, with authentication, a PostgreSQL schema for the full filmmaking pipeline, and ports for storage, jobs, AI, and rendering. It does **not** generate films yet.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the analysis, technology choices, deferred work, roadmap, and MVP definition.

## What Phase 1 includes

- Next.js 16 App Router, TypeScript, Tailwind CSS, shadcn/ui
- PostgreSQL + Prisma 7
- Better Auth (email/password)
- Landing page, dashboard, and projects
- Extensible domain schema: User → Project → Media → Analysis → Story → Timeline → Render → Movie → Publish
- Ports (interfaces) for object storage, background jobs, AI Director, media analysis, and rendering
- Local filesystem storage adapter and Postgres job queue (enqueue only — no video worker)
- Structured JSON logging and typed `AppError`s
- Docker Compose for Postgres

## What is intentionally not built

- AI Director implementation
- Media upload, analysis, or transcoding
- Timeline editor
- Rendering / FFmpeg
- Publishing destinations
- Social features
- Mobile apps
- Any fake “generate movie” flow

## Prerequisites

- Node.js 20.19+ (22 is fine)
- PostgreSQL 16, either:
  - Docker: `docker compose up -d`
  - or a local Postgres with a `youflicks` database

## Run locally

```bash
cp .env.example .env
# Set BETTER_AUTH_SECRET to a long random string:
#   openssl rand -base64 32
# Set BETTER_AUTH_URL to the URL you will open in the browser.

docker compose up -d   # skip if Postgres is already running

npm install
npx prisma migrate dev --name init
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | App on port 43147 |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run db:studio` | Prisma Studio |
| `GET /api/health` | App + database check |

## Environment variables

See `.env.example`. Required:

- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — session signing secret (16+ characters)
- `BETTER_AUTH_URL` — public origin of the app
- `STORAGE_DRIVER` — `local` in Phase 1
- `STORAGE_LOCAL_PATH` — directory for local object storage
- `LOG_LEVEL` — `debug` \| `info` \| `warn` \| `error`

## Project layout

```
src/app/(marketing)     Landing
src/app/(auth)          Sign in / sign up
src/app/(app)           Authenticated studio
src/app/api             Auth + health
src/components          UI and layout
src/lib                 env, errors, logger, auth
src/server/db           Prisma client
src/server/ports        Storage, jobs, AI, renderer interfaces
src/server/adapters     Local storage, Postgres jobs
src/server/services     Application services
prisma/schema.prisma    Domain schema
```

## Next phases

Phase 2 starts at real media ingest through `StoragePort` and job enqueue for analysis. Do not implement a vendor-locked AI Director until that decision is made on purpose.
