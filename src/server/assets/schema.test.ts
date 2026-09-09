import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION } from "@/server/assets/schema";
import { validateGeneratedAssetDocument } from "@/server/assets/validate";

function validDocument(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION,
    kind: "IMAGE",
    role: "intimate_portrait",
    mimeType: "image/png",
    width: 1,
    height: 1,
    checksum: "abc",
    storageKey: "projects/p1/generated/intimate_portrait/abc/original.png",
    origin: "GENERATED",
    fulfillment: {
      timelineId: "tl_1",
      timelineVersion: 1,
      storySceneId: "scene-1",
    },
    source: {
      storyStructureId: "story_1",
      storyStructureVersion: 1,
    },
    ...overrides,
  };
}

describe("GeneratedAssetDocument schema v1", () => {
  it("requires the locked field tree and kind set", () => {
    expect(() => validateGeneratedAssetDocument({ title: "Nope" })).toThrow(AppError);
    const document = validateGeneratedAssetDocument(validDocument());
    expect(document.schemaVersion).toBe("1.0");
    expect(document.kind).toBe("IMAGE");
    expect(document.storageKey).not.toMatch(/^https?:\/\//);
  });

  it("rejects vendor-host URLs as storageKey", () => {
    expect(() =>
      validateGeneratedAssetDocument(
        validDocument({ storageKey: "https://cdn.vendor.example/out.png" }),
      ),
    ).toThrow(AppError);
  });

  it("rejects render/VLC/sponsor/host JSON smuggling", () => {
    expect(() => validateGeneratedAssetDocument(validDocument({ ffmpeg: {} }))).toThrow(AppError);
    expect(() => validateGeneratedAssetDocument(validDocument({ vlc: true }))).toThrow(AppError);
    expect(() => validateGeneratedAssetDocument(validDocument({ sponsor: {} }))).toThrow(AppError);
    expect(() =>
      validateGeneratedAssetDocument(validDocument({ hostJson: { vendor: true } })),
    ).toThrow(AppError);
  });

  it("requires sourceMediaAssetId for ENHANCEMENT and matching mime/kind", () => {
    expect(() =>
      validateGeneratedAssetDocument(
        validDocument({
          kind: "ENHANCEMENT",
          origin: "PROCESSED",
          mimeType: "image/png",
        }),
      ),
    ).toThrow(/sourceMediaAssetId/i);

    const document = validateGeneratedAssetDocument(
      validDocument({
        kind: "ENHANCEMENT",
        origin: "PROCESSED",
        mimeType: "image/png",
        sourceMediaAssetId: "media_1",
      }),
    );
    expect(document.origin).toBe("PROCESSED");
  });

  it("rejects mimeType that does not match kind", () => {
    expect(() =>
      validateGeneratedAssetDocument(validDocument({ kind: "VOICE_OVER", mimeType: "image/png" })),
    ).toThrow(AppError);
  });
});
