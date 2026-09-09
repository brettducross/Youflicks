import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { RenderExecutionAttribution } from "@/server/adapters/renderer/attribution";
import { RenderCapability } from "@/server/ports/capabilities";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoragePort } from "@/server/ports/storage";
import type { RenderComposerInput } from "@/server/render/input";
import { renderResultDocumentSchema, type RenderResultDocument } from "@/server/render/schema";
import { validateRenderResultDocument } from "@/server/render/validate";

export type HttpRendererConfig = {
  providerKey: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
};

/**
 * Replaceable HTTP renderer. Provider-neutral: any host that accepts
 * a YouFlicks-owned render JSON body and returns bytes or a result document.
 * Configured only when URL, key, and model are set.
 * Attribution is adapter metadata — not part of RendererPort.render.
 */
export class HttpRendererAdapter implements RendererPort {
  readonly production = true as const;

  constructor(
    private readonly storage: StoragePort,
    private readonly config: HttpRendererConfig,
  ) {}

  get providerKey() {
    return this.config.providerKey;
  }

  get configured() {
    return Boolean(this.config.baseUrl && this.config.apiKey && this.config.model);
  }

  executionAttribution(): RenderExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability: RenderCapability.VIDEO_RENDER,
      modelId: this.config.model ?? null,
      modelVersion: null,
    };
  }

  async render(input: RenderComposerInput): Promise<RenderResultDocument> {
    if (!this.configured) {
      throw AppError.renderProviderUnavailable("No production renderer adapter is configured.");
    }

    const baseUrl = this.config.baseUrl!.replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 120_000);

    try {
      const response = await fetch(`${baseUrl}/v1/render`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        logger.error("render.http_failed", {
          providerKey: this.providerKey,
          status: response.status,
          body: redact(text, this.config.apiKey).slice(0, 500),
        });
        throw AppError.renderProviderUnavailable("The renderer adapter failed.");
      }

      const payload = (await response.json()) as {
        mimeType?: string;
        bytesBase64?: string;
        durationMs?: number;
        width?: number;
        height?: number;
        document?: unknown;
      };

      if (payload.document) {
        const parsed = renderResultDocumentSchema.safeParse(payload.document);
        if (!parsed.success) {
          throw AppError.renderResultInvalid(
            "The renderer adapter returned a document outside the YouFlicks schema.",
            { issues: parsed.error.issues.map((issue) => issue.message) },
          );
        }
        if (looksLikeVendorUrl(parsed.data.storageKey)) {
          throw AppError.renderResultInvalid(
            "The renderer adapter returned a vendor URL as storageKey.",
          );
        }
        return validateRenderResultDocument(parsed.data);
      }

      if (!payload.bytesBase64 || !payload.mimeType) {
        throw AppError.renderResultInvalid("The renderer adapter returned no output bytes.");
      }

      const bytes = Uint8Array.from(Buffer.from(payload.bytesBase64, "base64"));
      if (bytes.byteLength === 0) {
        throw AppError.renderResultInvalid("The renderer adapter returned empty bytes.");
      }
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const storageKey = input.destinationKeyHint;
      await this.storage.put({
        key: storageKey,
        body: bytes,
        contentType: payload.mimeType,
      });

      return validateRenderResultDocument({
        storageKey,
        mimeType: payload.mimeType,
        durationMs: payload.durationMs ?? input.manifest.totalDurationMs,
        byteSize: bytes.byteLength,
        checksum,
        width: payload.width,
        height: payload.height,
      });
    } catch (error) {
      if (isAppErrorLike(error)) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw AppError.renderProviderUnavailable("The renderer adapter timed out.");
      }
      throw AppError.renderProviderUnavailable(
        error instanceof Error ? error.message : "The renderer adapter failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function looksLikeVendorUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^s3:\/\//i.test(value);
}

function redact(text: string, secret?: string) {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

function isAppErrorLike(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AppError"
  );
}
