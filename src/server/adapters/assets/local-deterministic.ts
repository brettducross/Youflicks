import { createHash } from "node:crypto";
import type { AssetExecutionAttribution } from "@/server/adapters/assets/attribution";
import type { AssetGeneratorInput } from "@/server/assets/input";
import { capabilityForKind, originForKind } from "@/server/assets/kinds";
import {
  GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION,
  type GeneratedAssetDocument,
} from "@/server/assets/schema";
import { AssetCapability, type AssetCapabilityValue } from "@/server/ports/capabilities";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { StoragePort } from "@/server/ports/storage";

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** Minimal valid WAV (silence, 44-byte header + 16 samples). */
const WAV_SILENCE = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x2c, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
  0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00,
  0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

const MP4_PLACEHOLDER = Uint8Array.from(
  Buffer.from("YouFlicks local deterministic video placeholder\n", "utf8"),
);

/**
 * Deterministic asset generator for tests and explicit local development.
 * Not production AI. Must never advertise production asset availability.
 * Writes tiny placeholder bytes through StoragePort. Attribution is adapter
 * metadata — not part of AssetGeneratorPort.generate.
 */
export class LocalDeterministicAssetGenerator implements AssetGeneratorPort {
  readonly providerKey = "youflicks.local.asset";
  readonly production = false as const;
  readonly modelId = "deterministic-asset-v1";
  readonly modelVersion = "1.0";
  readonly supportedCapabilities = [
    AssetCapability.IMAGE_GENERATION,
    AssetCapability.VOICE_SYNTHESIS,
    AssetCapability.MUSIC_GENERATION,
    AssetCapability.SFX_GENERATION,
    AssetCapability.VIDEO_GENERATION,
    AssetCapability.MEDIA_ENHANCEMENT,
  ] as const;

  constructor(private readonly storage: StoragePort) {}

  executionAttribution(
    capability: AssetCapabilityValue = AssetCapability.IMAGE_GENERATION,
  ): AssetExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability,
      modelId: this.modelId,
      modelVersion: this.modelVersion,
    };
  }

  async generate(input: AssetGeneratorInput): Promise<GeneratedAssetDocument> {
    const { bytes, mimeType, width, height, durationMs, extension } = placeholderForKind(input.kind);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `projects/${input.projectId}/generated/${input.role}/${checksum.slice(0, 16)}/original.${extension}`;
    await this.storage.put({
      key: storageKey,
      body: bytes,
      contentType: mimeType,
    });

    return {
      schemaVersion: GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION,
      kind: input.kind,
      role: input.role,
      title: input.role.replaceAll("_", " "),
      mimeType,
      durationMs,
      width,
      height,
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
      rationale:
        "Local deterministic asset generator: placeholder bytes written to StoragePort. Not production AI.",
    };
  }
}

function placeholderForKind(kind: AssetGeneratorInput["kind"]) {
  switch (kind) {
    case "IMAGE":
    case "ENHANCEMENT":
      return {
        bytes: PNG_1X1,
        mimeType: "image/png",
        width: 1,
        height: 1,
        durationMs: undefined,
        extension: "png",
      };
    case "VOICE_OVER":
    case "MUSIC":
    case "SFX":
      return {
        bytes: WAV_SILENCE,
        mimeType: "audio/wav",
        width: undefined,
        height: undefined,
        durationMs: 1,
        extension: "wav",
      };
    case "VIDEO_CLIP":
      return {
        bytes: MP4_PLACEHOLDER,
        mimeType: "video/mp4",
        width: 2,
        height: 2,
        durationMs: 1_000,
        extension: "mp4",
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
