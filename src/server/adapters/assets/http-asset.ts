import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AssetExecutionAttribution } from "@/server/adapters/assets/attribution";
import type { AssetGeneratorInput } from "@/server/assets/input";
import { capabilityForKind, originForKind } from "@/server/assets/kinds";
import {
  GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION,
  type GeneratedAssetDocument,
} from "@/server/assets/schema";
import { generatedAssetDocumentSchema } from "@/server/assets/schema";
import { AssetCapability, type AssetCapabilityValue } from "@/server/ports/capabilities";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { StoragePort } from "@/server/ports/storage";

export type HttpAssetGeneratorConfig = {
  providerKey: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  capabilities?: AssetCapabilityValue[];
};

/**
 * Replaceable HTTP asset generator. Provider-neutral: any host that accepts
 * a YouFlicks-owned generate JSON body and returns bytes or a document.
 * Configured only when URL, key, and model are set.
 * Attribution is adapter metadata — not part of AssetGeneratorPort.generate.
 */
export class HttpAssetGeneratorAdapter implements AssetGeneratorPort {
  readonly production = true as const;

  constructor(
    private readonly storage: StoragePort,
    private readonly config: HttpAssetGeneratorConfig,
  ) {}

  get providerKey() {
    return this.config.providerKey;
  }

  get configured() {
    return Boolean(this.config.baseUrl && this.config.apiKey && this.config.model);
  }

  supportedCapabilities(): AssetCapabilityValue[] {
    if (this.config.capabilities && this.config.capabilities.length > 0) {
      return this.config.capabilities;
    }
    return [
      AssetCapability.IMAGE_GENERATION,
      AssetCapability.VOICE_SYNTHESIS,
      AssetCapability.MUSIC_GENERATION,
      AssetCapability.SFX_GENERATION,
      AssetCapability.VIDEO_GENERATION,
      AssetCapability.MEDIA_ENHANCEMENT,
    ];
  }

  supports(capability: AssetCapabilityValue) {
    return this.supportedCapabilities().includes(capability);
  }

  executionAttribution(capability: AssetCapabilityValue): AssetExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability,
      modelId: this.config.model ?? null,
      modelVersion: null,
    };
  }

  async generate(input: AssetGeneratorInput): Promise<GeneratedAssetDocument> {
    if (!this.configured) {
      throw AppError.assetProviderUnavailable(
        "No production asset generator adapter is configured.",
      );
    }
    const capability = capabilityForKind(input.kind);
    if (!this.supports(capability)) {
      throw AppError.assetCapabilityUnavailable(capability);
    }

    const baseUrl = this.config.baseUrl!.replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 90_000);

    try {
      const response = await fetch(`${baseUrl}/v1/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          kind: input.kind,
          role: input.role,
          input,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        logger.error("asset.http_failed", {
          providerKey: this.providerKey,
          status: response.status,
          body: redact(text, this.config.apiKey).slice(0, 500),
        });
        throw AppError.assetProviderUnavailable("The asset generator adapter failed.");
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
        const parsed = generatedAssetDocumentSchema.safeParse(payload.document);
        if (!parsed.success) {
          throw AppError.assetDocumentInvalid(
            "The asset generator adapter returned a document outside the YouFlicks schema.",
            { issues: parsed.error.issues.map((issue) => issue.message) },
          );
        }
        if (looksLikeVendorUrl(parsed.data.storageKey)) {
          throw AppError.assetDocumentInvalid(
            "The asset generator adapter returned a vendor URL as storageKey.",
          );
        }
        return parsed.data;
      }

      if (!payload.bytesBase64 || !payload.mimeType) {
        throw AppError.assetDocumentInvalid(
          "The asset generator adapter returned no asset bytes.",
        );
      }

      const bytes = Uint8Array.from(Buffer.from(payload.bytesBase64, "base64"));
      if (bytes.byteLength === 0) {
        throw AppError.assetDocumentInvalid("The asset generator adapter returned empty bytes.");
      }
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const extension = extensionForMime(payload.mimeType);
      const storageKey = `projects/${input.projectId}/generated/${input.role}/${checksum.slice(0, 16)}/original.${extension}`;
      await this.storage.put({
        key: storageKey,
        body: bytes,
        contentType: payload.mimeType,
      });

      return {
        schemaVersion: GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION,
        kind: input.kind,
        role: input.role,
        mimeType: payload.mimeType,
        durationMs: payload.durationMs,
        width: payload.width,
        height: payload.height,
        checksum,
        storageKey,
        origin: originForKind(input.kind),
        sourceMediaAssetId: input.sourceMediaAssetId,
        fulfillment: {
          timelineId: input.timelineId,
          timelineVersion: input.timelineVersion,
          storySceneId: input.storySceneId,
          unmetReason: input.reason,
        },
        source: {
          storyStructureId: input.storyStructureId,
          storyStructureVersion: input.storyStructureVersion,
          briefFingerprint: input.briefFingerprint,
        },
      };
    } catch (error) {
      if (isAppErrorLike(error)) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw AppError.assetProviderUnavailable("The asset generator adapter timed out.");
      }
      throw AppError.assetProviderUnavailable(
        error instanceof Error ? error.message : "The asset generator adapter failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  return "bin";
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
