# R1 — YouFlicks video HTTP gateway

First **production-shaped** `VIDEO_GENERATION` path. The app still talks only to `AssetGeneratorPort` through the existing `HttpAssetGeneratorAdapter`. A separate YouFlicks-shaped gateway implements `/v1/generate` and maps to an external video API **behind env**. Domain, Prisma, CreativePlan, Story, and Timeline never import a vendor SDK.

This is a scaffold. It is not an end-to-end movie without real keys and spend that Brett supplies separately. Do not commit secrets.

## How the pieces connect

```
App (ASSET_HTTP_*)
  → HttpAssetGeneratorAdapter  POST {baseUrl}/v1/generate
  → YouFlicks asset gateway (separate process)
  → config-backed queue backend (fal preset *or* Replicate/Wan I2V *or* generic HTTP)
  → download bytes
  → adapter writes opaque StoragePort key
  → AssetService persists GeneratedAsset + open providerKey
  → UsageMeter / EngineCostEvent (ops only; never plot)
```

`providerKey` stays an **open string** (`ASSET_HTTP_PROVIDER_KEY` / `YF_GATEWAY_PROVIDER_KEY`, default `http.asset`). Prisma already stores it as `String` — no vendor enums. A Replicate I2V run may record `replicate:wan-video/wan-2.7-i2v`; that is provenance, not a Prisma enum and not a permanent domain default.

Swap the **model** without code change:

- App: `ASSET_HTTP_MODEL=fal-ai/ltx-video` or `ASSET_HTTP_MODEL=wan-video/wan-2.7-i2v` (any open string)
- Or gateway: `YF_GATEWAY_MODEL=...` when the request omits `model`

Swap the **backend host** without code change:

- `YF_GATEWAY_BACKEND=fal` — default queue+webhook paths on `https://queue.fal.run`, `Authorization: Key`. Still valid when fal is unlocked.
- `YF_GATEWAY_BACKEND=replicate` — **alternate** transport. Authenticated `files.create` (Buffer) + official-model predictions. Pilot example: `wan-video/wan-2.7-i2v`. Token via `REPLICATE_API_TOKEN` on the **gateway process only**. Not a permanent architectural default.
- `YF_GATEWAY_BACKEND=http` — same path templates as fal, override host / auth / paths
- `YF_GATEWAY_BACKEND=mock` — tests only

## App env (`ASSET_HTTP_*`)

Set these on the Next.js process. The app never needs a fal or Replicate key.

| Variable | Role |
| --- | --- |
| `ASSET_HTTP_PROVIDER_KEY` | Open provenance string (default `http.asset`) |
| `ASSET_HTTP_BASE_URL` | Gateway origin, e.g. `http://127.0.0.1:43148` |
| `ASSET_HTTP_API_KEY` | Shared bearer key (same value as `YF_GATEWAY_API_KEY`) |
| `ASSET_HTTP_MODEL` | Open string passed through as `model` |
| `ASSET_HTTP_TIMEOUT_MS` | App wait for `/v1/generate` (use `300000` for video) |
| `ASSET_HTTP_CAPABILITIES` | Honest list. R1: `VIDEO_GENERATION`. Add `IMAGE_GENERATION` only if the gateway covers stills. |

Empty `ASSET_HTTP_CAPABILITIES` now means **VIDEO_GENERATION only** (honest R1). Do not list `VOICE_SYNTHESIS`, `MUSIC_GENERATION`, or `SFX_GENERATION` unless a real adapter covers them. Local deterministic (`ASSET_ALLOW_LOCAL`) still covers those kinds as **local / not production**.

## Gateway env (separate process)

Run:

```bash
npm run gateway:asset
```

| Variable | Role |
| --- | --- |
| `YF_GATEWAY_LISTEN_HOST` / `YF_GATEWAY_LISTEN_PORT` | Default `127.0.0.1:43148` |
| `YF_GATEWAY_API_KEY` | Required. Fail-closed without it |
| `YF_GATEWAY_PROVIDER_KEY` | Open string recorded on gateway jobs |
| `YF_GATEWAY_CAPABILITIES` | Default `VIDEO_GENERATION` |
| `YF_GATEWAY_BACKEND` | `fal` (default example) \| `replicate` (alternate) \| `http` \| `mock` |
| `YF_GATEWAY_BACKEND_BASE_URL` | Default `https://queue.fal.run` (`fal`/`http`) or `https://api.replicate.com` (`replicate`) |
| `YF_GATEWAY_BACKEND_API_KEY` | Required for `fal` / `http` / `replicate`. Fail-closed |
| `FAL_KEY` | Alias for the backend key on the **gateway process only** |
| `REPLICATE_API_TOKEN` | Alias for the backend key when `YF_GATEWAY_BACKEND=replicate`. Gateway process only. Fail-closed if missing |
| `YF_GATEWAY_BACKEND_AUTH_SCHEME` | `Key` for fal, `Bearer` for many others |
| `YF_GATEWAY_MODEL` | Default open-string model when the request omits one |
| `YF_GATEWAY_IMAGE_MODEL` | Optional stills model if IMAGE is advertised |
| `YF_GATEWAY_WEBHOOK_URL` | Public URL for queue completion (`fal_webhook` on the fal preset) |
| `YF_GATEWAY_WEBHOOK_QUERY` | Query param name (default `fal_webhook` for fal) |
| `YF_GATEWAY_SUBMIT_PATH` | Default `/{model}` |
| `YF_GATEWAY_STATUS_PATH` | Default `/{model}/requests/{id}/status` |
| `YF_GATEWAY_RESULT_PATH` | Default `/{model}/requests/{id}` |
| `YF_GATEWAY_BACKEND_INPUT_JSON` | Extra JSON merged into the backend submit body |
| `YF_GATEWAY_TIMEOUT_MS` / `YF_GATEWAY_POLL_MS` | Queue wait (default 300s / 2s) |
| `YF_GATEWAY_MAX_JOBS` | Spend guardrail: max accepted jobs |
| `YF_GATEWAY_MAX_SPEND_USD` | Spend guardrail: estimated USD cap |
| `YF_GATEWAY_ESTIMATED_USD_PER_JOB` | Placeholder estimate (default `0.5`) |
| `YF_GATEWAY_DOWNLOAD_MAX_BYTES` | Max downloaded asset bytes |

Point the default fal example at a real key (Brett supplies this; not in git):

```bash
# Next.js .env
ASSET_HTTP_PROVIDER_KEY="http.asset"
ASSET_HTTP_BASE_URL="http://127.0.0.1:43148"
ASSET_HTTP_API_KEY="replace-with-shared-gateway-key"
ASSET_HTTP_MODEL="fal-ai/ltx-video"
ASSET_HTTP_TIMEOUT_MS="300000"
ASSET_HTTP_CAPABILITIES="VIDEO_GENERATION"

# Gateway process env
YF_GATEWAY_API_KEY="replace-with-shared-gateway-key"
YF_GATEWAY_BACKEND="fal"
YF_GATEWAY_BACKEND_API_KEY="replace-with-fal-key"
YF_GATEWAY_MODEL="fal-ai/ltx-video"
YF_GATEWAY_MAX_JOBS="10"
YF_GATEWAY_MAX_SPEND_USD="5"
```

Point at another queue without code change: set `YF_GATEWAY_BACKEND=http`, `YF_GATEWAY_BACKEND_BASE_URL`, `YF_GATEWAY_BACKEND_AUTH_SCHEME`, `YF_GATEWAY_MODEL`, and optionally the path templates.

### Alternate transport: Replicate / Wan I2V

Replicate is a **swappable HTTP backend**, not a YouFlicks domain service. The app still only speaks `/v1/generate`. Domain, Prisma, CreativePlan, Story, Timeline, Render, Keep, and Playback never import a Replicate SDK.

Start frames are uploaded with authenticated `POST /v1/files` (`files.create`, Buffer / multipart). **Do not** use public file hosts (catbox, 0x0, etc.). The gateway then calls the official-model predictions API. Default open-string model for this preset is `wan-video/wan-2.7-i2v` (`first_frame` + prompt). Override with `YF_GATEWAY_MODEL` / `ASSET_HTTP_MODEL`.

Pilot spend defaults on this transport (overridable via `YF_GATEWAY_BACKEND_INPUT_JSON`): `duration=2`, `resolution=720p`. Caps remain `YF_GATEWAY_MAX_JOBS` / `YF_GATEWAY_MAX_SPEND_USD`.

```bash
# Next.js .env — still no vendor token
ASSET_HTTP_PROVIDER_KEY="replicate:wan-video/wan-2.7-i2v"
ASSET_HTTP_BASE_URL="http://127.0.0.1:43148"
ASSET_HTTP_API_KEY="replace-with-shared-gateway-key"
ASSET_HTTP_MODEL="wan-video/wan-2.7-i2v"
ASSET_HTTP_TIMEOUT_MS="300000"
ASSET_HTTP_CAPABILITIES="VIDEO_GENERATION"

# Gateway process env — vendor token stays here
YF_GATEWAY_API_KEY="replace-with-shared-gateway-key"
YF_GATEWAY_BACKEND="replicate"
REPLICATE_API_TOKEN="replace-with-replicate-token"
YF_GATEWAY_MODEL="wan-video/wan-2.7-i2v"
YF_GATEWAY_PROVIDER_KEY="replicate:wan-video/wan-2.7-i2v"
YF_GATEWAY_MAX_JOBS="1"
YF_GATEWAY_MAX_SPEND_USD="2"
npm run gateway:asset
```

`providerKey` on `GeneratedAsset` is copied from `ASSET_HTTP_PROVIDER_KEY` (adapter attribution outside `AssetGeneratorPort.generate`). Set it to the same open string as `YF_GATEWAY_PROVIDER_KEY` so provenance matches the transport you actually ran.

#### Live integration under caps (optional; not CI)

CI uses recorded Replicate HTTP fixtures (no live spend). To run **one** live I2V job:

```bash
YF_GATEWAY_LIVE_REPLICATE=1 \
REPLICATE_API_TOKEN="replace-with-replicate-token" \
YF_GATEWAY_MAX_JOBS="1" \
YF_GATEWAY_MAX_SPEND_USD="2" \
npm test -- src/server/gateways/yf-asset/replicate.live.test.ts
```

Optional start-frame override (base64 PNG/JPEG in extra JSON — still uploaded via `files.create`, never a public URL):

```bash
YF_GATEWAY_BACKEND_INPUT_JSON='{"imageBytesBase64":"<base64>","duration":2,"resolution":"720p"}'
```

Without `imageBytesBase64`, the replicate transport synthesizes a local 512×512 JPEG and uploads it. Missing `REPLICATE_API_TOKEN` fails closed.

fal remains the documented default example and stays valid when unlocked. Choosing Replicate here does **not** lock YouFlicks to Wan.

## Persistence honesty

- App: YouFlicks `Job.id` + `GeneratedAsset.providerKey` (open string) + opaque `storageKey` + normalized document metadata.
- Gateway: in-memory YouFlicks `jobId` + normalized HTTPS asset URL/mime/size hints + open `providerKey`. Backend request ids are only a correlation map for webhooks — not CreativePlan / Story / Timeline.
- Vendor JSON is never stored as domain truth.

## Capability honesty

| Capability | R1 HTTP / gateway | Local deterministic |
| --- | --- | --- |
| `VIDEO_GENERATION` | Advertised when configured | Local only |
| `IMAGE_GENERATION` | Opt-in via env | Local only |
| `VOICE_SYNTHESIS` / `MUSIC_GENERATION` / `SFX_GENERATION` | Unmet (not advertised) | Local only |
| `MEDIA_ENHANCEMENT` | Unmet (not advertised) | Local only |

## EngineCostEvent / spend

`AssetService` already records `UsageEvent` + `EngineCostEvent` on `ASSET_CALL` (ops / finance). Cost does not enter Director, Story, Timeline, or CreativePlan.

Gateway spend caps (`YF_GATEWAY_MAX_JOBS`, `YF_GATEWAY_MAX_SPEND_USD`) are process-local placeholders. Brett sets real numbers with real keys. Hitting a cap returns `429` / `GATEWAY_SPEND_CAP` and does not rewrite plot.

## R2 render (out of scope)

R1 does not change M4. The local FFmpeg path for ingest posters / duration (and the existing local/deterministic renderer when `RENDER_ALLOW_LOCAL=true`) still works as documented in the README. Production render remains `RENDER_HTTP_*` when configured. No FFmpeg graph is CreativePlan truth.

## What this is not

- Not R3 Director LLM
- Not a Kling / Runway / OpenAI / ElevenLabs Prisma enum
- Not M8.5b billing checkout
- Not product UI that names a vendor as creative chrome
- Not a claim that an E2E movie can be generated without keys
