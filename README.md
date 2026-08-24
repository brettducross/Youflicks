# YouFlicks

**Your footage. Your story. Your film.**

YouFlicks is an AI-powered filmmaking platform that turns a person’s photos, videos, memories, and ideas into a finished movie.

This repository currently includes **Phase 1 (foundation)** and **Phase 2A (media ingest)**. It does not generate films, run an AI Director, or render a timeline.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the analysis, technology choices, deferred work, roadmap, and MVP definition.

## What is built

- Next.js 16 App Router, TypeScript, Tailwind CSS, shadcn/ui
- PostgreSQL + Prisma 7
- Better Auth (email/password)
- Landing page, dashboard, and projects
- Media ingest: upload photos/videos into a project, store them through `StoragePort`, list and remove them in a media library
- Extensible domain schema: User → Project → Media → Analysis → Story → Timeline → Render → Movie → Publish
- Ports for object storage, background jobs, AI Director, media analysis, and rendering
- Local filesystem storage adapter (swap later for S3/R2 behind the same port)
- Structured JSON logging and typed `AppError`s

## What is intentionally not built

- AI Director
- Media analysis / scene detection
- Timeline editor
- Rendering
- Publishing / UFlix Global
- Social features
- Mobile apps

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
| `npm run test` | Ingest, storage, and validation tests |
| `npm run lint` | ESLint |
| `npm run db:studio` | Prisma Studio |
| `GET /api/health` | App + database check |

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
src/server/ports        Storage, jobs, AI, renderer interfaces
src/server/adapters     Local storage, Postgres jobs
src/server/services     ProjectService, MediaService
prisma/schema.prisma    Domain schema
```

## Current limitations (Phase 2A)

- Uploads are buffered in the Next.js process. They are not chunked or resumable.
- HEIC/HEIF is accepted when magic bytes match; a thumbnail is generated only if libvips/sharp can decode the file.
- Video posters and duration need FFmpeg/ffprobe. Ingest still succeeds without them; the library shows a film glyph until a preview exists.
- The storage adapter is local disk. An S3/R2 adapter can be added behind `StoragePort` without changing MediaService or the UI.
- There is no media analysis, AI Director, timeline, or renderer yet.

## Next phase

Phase 2B is media analysis behind `MediaAnalyzerPort` — still not the AI Director. Do not start it until Phase 2A is accepted.
