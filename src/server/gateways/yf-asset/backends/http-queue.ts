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

/**
 * Generic queue HTTP backend. The `fal` preset fills fal queue+webhook paths
 * and `Authorization: Key` — still raw HTTP, no fal SDK.
 */
export class HttpQueueVideoBackend implements VideoBackend {
  readonly kind: string;

  constructor(
    private readonly config: YfAssetGatewayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.kind = config.backend;
  }

  async submit(input: BackendSubmitInput): Promise<BackendSubmitResult> {
    const url = this.buildUrl(this.config.submitPath, input.model);
    const webhookUrl = input.webhookUrl ?? this.config.webhookUrl;
    const submitUrl = webhookUrl
      ? appendQuery(url, this.config.webhookQueryParam, webhookUrl)
      : url;
    const response = await this.fetchImpl(submitUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `${this.config.backendAuthScheme} ${this.config.backendApiKey}`,
      },
      body: JSON.stringify({
        prompt: input.prompt,
        ...input.extra,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Backend submit failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = (await response.json()) as unknown;
    const backendRequestId = extractBackendRequestId(payload);
    if (!backendRequestId) {
      throw new Error("Backend submit returned no request id.");
    }
    return { backendRequestId };
  }

  async status(model: string, backendRequestId: string): Promise<BackendStatusResult> {
    const url = this.buildUrl(this.config.statusPath, model, backendRequestId);
    const response = await this.fetchImpl(url, {
      headers: {
        authorization: `${this.config.backendAuthScheme} ${this.config.backendApiKey}`,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Backend status failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const status = mapQueueStatus(payload.status);
    const error = typeof payload.error === "string" ? payload.error : undefined;
    return { status, error };
  }

  async result(model: string, backendRequestId: string): Promise<NormalizedAssetMeta> {
    const url = this.buildUrl(this.config.resultPath, model, backendRequestId);
    const response = await this.fetchImpl(url, {
      headers: {
        authorization: `${this.config.backendAuthScheme} ${this.config.backendApiKey}`,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Backend result failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = (await response.json()) as unknown;
    const asset = normalizeBackendAsset(payload);
    if (!asset) {
      throw new Error("Backend result had no normalized asset URL.");
    }
    return asset;
  }

  private buildUrl(pathTemplate: string, model: string, id = ""): string {
    const base = this.config.backendBaseUrl.replace(/\/$/, "");
    const path = pathTemplate
      .replaceAll("{model}", model)
      .replaceAll("{id}", id)
      .replace(/^\/*/, "/");
    return `${base}${path}`;
  }
}

function appendQuery(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}
