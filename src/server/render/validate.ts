import { AppError } from "@/lib/errors";
import { assertNoSmuggledRenderVendorFields } from "@/server/render/privacy";
import {
  RENDER_MANIFEST_SCHEMA_VERSION,
  renderManifestSchema,
  renderResultDocumentSchema,
  type RenderManifest,
  type RenderResultDocument,
} from "@/server/render/schema";

export function validateRenderManifest(raw: unknown): RenderManifest {
  assertNoSmuggledRenderVendorFields(raw, "renderManifest");
  const parsed = renderManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.renderInputInvalid("Render manifest does not match the YouFlicks schema.", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const manifest = parsed.data;
  if (manifest.schemaVersion !== RENDER_MANIFEST_SCHEMA_VERSION) {
    throw AppError.renderInputInvalid("Unsupported render manifest schema version.", {
      schemaVersion: manifest.schemaVersion,
    });
  }
  assertClipTiming(manifest);
  assertOpaqueKeys(manifest.clips.map((clip) => clip.storageKey));
  return manifest;
}

export function validateRenderResultDocument(raw: unknown): RenderResultDocument {
  if (raw && typeof raw === "object" && "providerKey" in raw) {
    throw AppError.renderResultInvalid(
      "RendererPort must not return providerKey. Attribution lives outside the port.",
    );
  }
  assertNoSmuggledRenderVendorFields(raw, "renderResultDocument");
  const parsed = renderResultDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.renderResultInvalid("Render result does not match the YouFlicks schema.", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const document = parsed.data;
  assertOpaqueKeys([document.storageKey]);
  if (!document.mimeType.startsWith("video/") && document.mimeType !== "application/octet-stream") {
    throw AppError.renderResultInvalid("Render output mimeType must be a video type.", {
      mimeType: document.mimeType,
    });
  }
  return document;
}

function assertClipTiming(manifest: RenderManifest) {
  for (const clip of manifest.clips) {
    if (clip.timelineEndMs <= clip.timelineStartMs) {
      throw AppError.renderInputInvalid(
        "timelineEndMs must be greater than timelineStartMs on every render clip.",
        { clipId: clip.clipId },
      );
    }
  }
  const maxEnd = manifest.clips.reduce((max, clip) => Math.max(max, clip.timelineEndMs), 0);
  if (manifest.totalDurationMs < maxEnd) {
    throw AppError.renderInputInvalid("totalDurationMs must cover the last clip end.", {
      totalDurationMs: manifest.totalDurationMs,
      maxEnd,
    });
  }
}

function looksLikeVendorUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^s3:\/\//i.test(value);
}

function assertOpaqueKeys(keys: string[]) {
  for (const key of keys) {
    if (looksLikeVendorUrl(key)) {
      throw AppError.renderResultInvalid(
        "storageKey must be an opaque StoragePort key, not a vendor URL.",
      );
    }
  }
}
