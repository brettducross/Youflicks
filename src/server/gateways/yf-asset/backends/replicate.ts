import sharp from "sharp";
import type { YfAssetGatewayConfig } from "@/server/gateways/yf-asset/config";
import {
  extractBackendRequestId,
  mapQueueStatus,
  normalizeBackendAsset,
} from "@/server/gateways/yf-asset/normalize";
import type {
  BackendStatusResult,
  BackendSubmitInput,
  BackendSubmitResult,
  VideoBackend,
} from "@/server/gateways/yf-asset/backends/types";
import type { NormalizedAssetMeta } from "@/server/gateways/yf-asset/jobs";

const PUBLIC_FILE_HOSTS =
  /catbox\.moe|0x0\.st|litterbox|transfer\.sh|file\.io|tmpfiles\.org|imgur\.com/i;

const STRIP_EXTRA_KEYS = new Set([
  "imageBytesBase64",
  "image_bytes_base64",
  "image",
  "image_url",
  "first_frame",
  "firstFrame",
]);

/**
 * Replicate HTTP transport. Raw fetch only — no vendor SDK, not domain truth.
 * I2V start frames go through authenticated files.create (Buffer), never public hosts.
 */
export class ReplicateVideoBackend implements VideoBackend {
  readonly kind = "replicate";

  constructor(
    private readonly config: YfAssetGatewayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async submit(input: BackendSubmitInput): Promise<BackendSubmitResult> {
    this.assertToken();
    rejectPublicFileHosts(input.extra);

    const frame = await resolveFirstFrame(input.extra);
    const uploaded = await this.uploadFile(frame);
    const extra = stripUploadOnlyExtra(input.extra);
    const body = {
      input: {
        prompt: input.prompt,
        first_frame: uploaded,
        duration: 2,
        resolution: "720p",
        ...extra,
      },
      ...(input.webhookUrl || this.config.webhookUrl
        ? { webhook: input.webhookUrl ?? this.config.webhookUrl }
        : {}),
    };

    const response = await this.fetchImpl(this.predictionCreateUrl(input.model), {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Replicate submit failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = (await response.json()) as unknown;
    const backendRequestId = extractBackendRequestId(payload);
    if (!backendRequestId) {
      throw new Error("Replicate submit returned no prediction id.");
    }
    return { backendRequestId };
  }

  async status(_model: string, backendRequestId: string): Promise<BackendStatusResult> {
    this.assertToken();
    const payload = await this.getPrediction(backendRequestId);
    const status = mapQueueStatus(payload.status);
    const error = typeof payload.error === "string" ? payload.error : undefined;
    return { status, error };
  }

  async result(_model: string, backendRequestId: string): Promise<NormalizedAssetMeta> {
    this.assertToken();
    const payload = await this.getPrediction(backendRequestId);
    const asset = normalizeBackendAsset(payload);
    if (!asset) {
      throw new Error("Replicate result had no normalized asset URL.");
    }
    return asset;
  }

  private async uploadFile(frame: { bytes: Uint8Array; mimeType: string; filename: string }) {
    const form = new FormData();
    form.append(
      "content",
      new Blob([Buffer.from(frame.bytes)], { type: frame.mimeType }),
      frame.filename,
    );
    const response = await this.fetchImpl(this.filesUrl(), {
      method: "POST",
      headers: {
        authorization: this.authorization(),
      },
      body: form,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Replicate files.create failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = (await response.json()) as unknown;
    const url = fileGetUrl(payload);
    if (!url) {
      throw new Error("Replicate files.create returned no authenticated file URL.");
    }
    if (PUBLIC_FILE_HOSTS.test(url)) {
      throw new Error("Replicate files.create returned a public file host URL.");
    }
    return url;
  }

  private async getPrediction(backendRequestId: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.predictionGetUrl(backendRequestId), {
      headers: this.jsonHeaders(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Replicate status failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Replicate status returned a non-object payload.");
    }
    return payload as Record<string, unknown>;
  }

  private predictionCreateUrl(model: string): string {
    const base = this.config.backendBaseUrl.replace(/\/$/, "");
    if (model.includes("/")) {
      return `${base}/v1/models/${model}/predictions`;
    }
    return `${base}/v1/predictions`;
  }

  private predictionGetUrl(id: string): string {
    const base = this.config.backendBaseUrl.replace(/\/$/, "");
    return `${base}/v1/predictions/${id}`;
  }

  private filesUrl(): string {
    return `${this.config.backendBaseUrl.replace(/\/$/, "")}/v1/files`;
  }

  private jsonHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: this.authorization(),
    };
  }

  private authorization(): string {
    return `${this.config.backendAuthScheme} ${this.config.backendApiKey}`;
  }

  private assertToken(): void {
    if (!this.config.backendApiKey) {
      throw new Error(
        "REPLICATE_API_TOKEN (or YF_GATEWAY_BACKEND_API_KEY) is required. The replicate transport fails closed without a token.",
      );
    }
  }
}

function fileGetUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const urls = (payload as { urls?: { get?: unknown } }).urls;
  return typeof urls?.get === "string" && urls.get.startsWith("https://") ? urls.get : undefined;
}

function rejectPublicFileHosts(extra: Record<string, unknown>): void {
  for (const value of Object.values(extra)) {
    if (typeof value === "string" && (/^https?:\/\//i.test(value) || PUBLIC_FILE_HOSTS.test(value))) {
      throw new Error(
        "Replicate transport refuses public file hosts. Start frames must be uploaded with authenticated files.create.",
      );
    }
  }
}

function stripUploadOnlyExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (STRIP_EXTRA_KEYS.has(key)) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

const FALLBACK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function resolveFirstFrame(extra: Record<string, unknown>): Promise<{
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}> {
  const encoded =
    (typeof extra.imageBytesBase64 === "string" && extra.imageBytesBase64) ||
    (typeof extra.image_bytes_base64 === "string" && extra.image_bytes_base64) ||
    "";
  if (encoded) {
    const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
    if (bytes.byteLength === 0) {
      throw new Error("imageBytesBase64 decoded to empty bytes.");
    }
    return { bytes, mimeType: "image/png", filename: "first_frame.png" };
  }

  try {
    const bytes = await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 3,
        background: { r: 36, g: 68, b: 104 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { bytes: new Uint8Array(bytes), mimeType: "image/jpeg", filename: "first_frame.jpg" };
  } catch {
    return { bytes: new Uint8Array(FALLBACK_PNG), mimeType: "image/png", filename: "first_frame.png" };
  }
}
