import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { MediaKind } from "@/server/media/constants";
import { sanitizeFilename, sniffMedia, validateByteSize } from "@/server/media/sniff";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("sniffMedia", () => {
  it("detects PNG from magic bytes, ignoring a lying filename", async () => {
    const sniffed = await sniffMedia(new Uint8Array(PNG_1X1));
    expect(sniffed.mimeType).toBe("image/png");
    expect(sniffed.kind).toBe(MediaKind.PHOTO);
  });

  it("detects JPEG from magic bytes", async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 32, g: 32, b: 32 } },
    })
      .jpeg()
      .toBuffer();
    const sniffed = await sniffMedia(new Uint8Array(jpeg));
    expect(sniffed.mimeType).toBe("image/jpeg");
    expect(sniffed.kind).toBe(MediaKind.PHOTO);
  });

  it("rejects GIF even when the filename claims to be a JPEG", async () => {
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );
    await expect(sniffMedia(new Uint8Array(gif))).rejects.toBeInstanceOf(AppError);
  });

  it("rejects HTML disguised as an image", async () => {
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    await expect(sniffMedia(html)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects empty files", () => {
    expect(() => validateByteSize(0, MediaKind.PHOTO)).toThrow(/empty/);
  });

  it("rejects oversized photos", () => {
    expect(() =>
      validateByteSize(50 * 1024 * 1024, MediaKind.PHOTO, {
        maxImageBytes: 40 * 1024 * 1024,
        maxVideoBytes: 512 * 1024 * 1024,
      }),
    ).toThrow(/Photos must be/);
  });

  it("sanitizes nested filenames", () => {
    expect(sanitizeFilename("..\\..\\etc/passwd.jpg")).toBe("passwd.jpg");
  });
});
