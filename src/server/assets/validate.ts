import { AppError } from "@/lib/errors";
import { mimeMatchesKind, originForKind } from "@/server/assets/kinds";
import { assertNoSmuggledVendorFields } from "@/server/assets/privacy";
import {
  GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION,
  generatedAssetDocumentSchema,
  type GeneratedAssetDocument,
} from "@/server/assets/schema";

export function validateGeneratedAssetDocument(raw: unknown): GeneratedAssetDocument {
  assertNoSmuggledVendorFields(raw);
  const parsed = generatedAssetDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.assetDocumentInvalid(
      "Generated asset document does not match the YouFlicks schema.",
      { issues: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  const document = parsed.data;
  if (document.schemaVersion !== GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION) {
    throw AppError.assetDocumentInvalid("Unsupported generated asset document schema version.", {
      schemaVersion: document.schemaVersion,
    });
  }
  if (!mimeMatchesKind(document.kind, document.mimeType)) {
    throw AppError.assetDocumentInvalid("Generated asset mimeType does not match kind.", {
      kind: document.kind,
      mimeType: document.mimeType,
    });
  }
  const expectedOrigin = originForKind(document.kind);
  if (document.origin !== expectedOrigin) {
    throw AppError.assetDocumentInvalid("Generated asset origin must match kind.", {
      kind: document.kind,
      origin: document.origin,
    });
  }
  if (document.kind === "ENHANCEMENT" && !document.sourceMediaAssetId) {
    throw AppError.assetDocumentInvalid(
      "ENHANCEMENT / PROCESSED assets require sourceMediaAssetId.",
    );
  }
  if (document.kind !== "ENHANCEMENT" && document.sourceMediaAssetId) {
    throw AppError.assetDocumentInvalid(
      "sourceMediaAssetId is only allowed on ENHANCEMENT assets.",
    );
  }
  if (looksLikeVendorUrl(document.storageKey) || (document.previewKey && looksLikeVendorUrl(document.previewKey))) {
    throw AppError.assetDocumentInvalid(
      "storageKey and previewKey must be opaque StoragePort keys, not vendor URLs.",
    );
  }
  return document;
}

function looksLikeVendorUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^s3:\/\//i.test(value);
}
