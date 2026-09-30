import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { mimeMatchesKind } from "@/server/assets/kinds";
import { logger } from "@/lib/logger";
import {
  KEN_BURNS_PROVIDER_KEY,
  KEN_BURNS_SCALE_TO,
  KenBurnsProcessor,
  STATIC_SCALE_TO,
  buildKenBurnsParams,
  clampSlotDurationMs,
  ffmpegAvailable,
  renderProfilePixels,
  type KenBurnsRenderSpec,
} from "@/server/assets/kenburns";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import type { AssetGeneratorInput } from "@/server/assets/input";
import { renderManifestClipSchema, renderManifestSchema } from "@/server/render/schema";

const dir = await mkdtemp(path.join(tmpdir(), "youflicks-kb-test-"));
const storage = new LocalStorageAdapter(dir);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function patternedStill(): Promise<Uint8Array> {
  const red = await sharp({
    create: { width: 16, height: 32, channels: 3, background: { r: 220, g: 20, b: 20 } },
  })
    .png()
    .toBuffer();
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 40, b: 180 } },
  })
    .composite([{ input: red, left: 0, top: 0 }])
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

function spec(overrides: Partial<KenBurnsRenderSpec> & Pick<KenBurnsRenderSpec, "stillBytes">): KenBurnsRenderSpec {
  return {
    processor: KEN_BURNS_PROVIDER_KEY,
    treatment: "KEN_BURNS",
    sourceMediaAssetId: "still-1",
    durationMs: 80,
    scaleFrom: 1,
    scaleTo: KEN_BURNS_SCALE_TO,
    panX: 0.5,
    panY: 0.5,
    panAnchor: "center",
    width: 32,
    height: 32,
    outputProfile: "WEB_720",
    projectId: "project-1",
    role: "portrait",
    timelineId: "timeline-1",
    timelineVersion: 1,
    ...overrides,
  };
}

describe("Ken Burns processor", () => {
  it("matches enhancement video mime and refuses a generative input", async () => {
    expect(ffmpegAvailable()).toBe(true);
    expect(mimeMatchesKind("ENHANCEMENT", "video/mp4")).toBe(true);
    expect(clampSlotDurationMs(null)).toBeNull();
    expect(clampSlotDurationMs(1.5)).toBeNull();
    expect(clampSlotDurationMs(0)).toBeNull();
    expect(clampSlotDurationMs(500)).toBe(2000);
    expect(clampSlotDurationMs(9000)).toBe(8000);
    expect(clampSlotDurationMs(3000)).toBe(3000);
    expect(renderProfilePixels("WEB_720")).toEqual({ width: 1280, height: 720 });
    expect(renderProfilePixels("WEB_1080")).toEqual({ width: 1920, height: 1080 });
    expect(renderProfilePixels("MASTER")).toEqual({ width: 1920, height: 1080 });
    expect(buildKenBurnsParams({
      treatment: "STATIC",
      sourceMediaAssetId: "still-1",
      slotDurationMs: null,
      panX: 0.5,
      panY: 0.5,
      panAnchor: "center",
    })).toBeNull();
    const motion = buildKenBurnsParams({
      treatment: "KEN_BURNS",
      sourceMediaAssetId: "still-1",
      slotDurationMs: 1500,
      panX: 0.25,
      panY: 0.5,
      panAnchor: "face",
      outputProfile: "WEB_1080",
    });
    expect(motion).toMatchObject({
      processor: KEN_BURNS_PROVIDER_KEY,
      treatment: "KEN_BURNS",
      durationMs: 2000,
      scaleFrom: 1,
      scaleTo: KEN_BURNS_SCALE_TO,
      width: 1920,
      height: 1080,
    });
    const held = buildKenBurnsParams({
      treatment: "STATIC",
      sourceMediaAssetId: "still-1",
      slotDurationMs: 2000,
      panX: 0.5,
      panY: 0.5,
      panAnchor: "center",
      outputProfile: "WEB_720",
    });
    expect(held?.scaleTo).toBe(STATIC_SCALE_TO);
    const processor = new KenBurnsProcessor(storage);
    await expect(processor.generate({} as AssetGeneratorInput)).rejects.toThrow(/generative AssetGeneratorInput/);
  });

  it("writes a deterministic silent H.264 file and a different file for static or a different pan", async () => {
    const stillBytes = await patternedStill();
    const processor = new KenBurnsProcessor(storage);
    const encodes: Array<Record<string, unknown>> = [];
    const originalInfo = logger.info;
    logger.info = (message, context) => {
      if (message === "asset.kenburns_encode") {
        encodes.push({ ...(context ?? {}) });
      }
      originalInfo(message, context);
    };
    let first;
    try {
    first = await processor.process(spec({ stillBytes, role: "det-a" }));
    const second = await processor.process(spec({ stillBytes, role: "det-b" }));
    expect(first.checksum).toBe(second.checksum);
    expect(first.mimeType).toBe("video/mp4");
    expect(first.kind).toBe("ENHANCEMENT");
    expect(first.origin).toBe("PROCESSED");
    expect(first.durationMs).toBe(80);
    const stored = await storage.get(first.storageKey);
    expect(stored?.body.byteLength).toBeGreaterThan(0);
    expect(createHash("sha256").update(stored!.body).digest("hex")).toBe(first.checksum);

    const probePath = path.join(dir, "probe.mp4");
    await writeFile(probePath, stored!.body);
    const probe = JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", probePath], {
        encoding: "utf8",
      }),
    ) as { streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }> };
    expect(probe.streams.map((stream) => stream.codec_type)).toEqual(["video"]);
    expect(probe.streams[0]).toMatchObject({ codec_name: "h264", width: 32, height: 32 });

    const held = await processor.process(spec({ stillBytes, treatment: "STATIC", scaleTo: STATIC_SCALE_TO, role: "static" }));
    expect(held.checksum).not.toBe(first.checksum);
    const panned = await processor.process(
      spec({ stillBytes, panX: 0.1, panY: 0.2, panAnchor: "face", scaleTo: 1.5, role: "pan" }),
    );
    const centered = await processor.process(
      spec({ stillBytes, panX: 0.9, panY: 0.8, panAnchor: "center", scaleTo: 1.5, role: "center" }),
    );
    expect(panned.checksum).not.toBe(centered.checksum);
    expect(encodes.length).toBeGreaterThan(0);
    expect(encodes[0]).toMatchObject({
      outcome: "succeeded",
      width: 32,
      height: 32,
      durationMs: 80,
      frames: 2,
    });
    expect(typeof encodes[0]?.peakTempBytes).toBe("number");
    expect(Number(encodes[0]?.peakTempBytes)).toBeGreaterThan(0);
    expect(typeof encodes[0]?.frameLoopMs).toBe("number");
    expect(typeof encodes[0]?.ffmpegMs).toBe("number");
    expect(typeof encodes[0]?.totalMs).toBe("number");
    } finally {
      logger.info = originalInfo;
    }
  }, 60_000);

  it("logs encode metrics when the still cannot be decoded", async () => {
    const failures: Array<Record<string, unknown>> = [];
    const originalError = logger.error;
    logger.error = (message, context) => {
      if (message === "asset.kenburns_encode") {
        failures.push({ ...(context ?? {}) });
      }
      originalError(message, context);
    };
    try {
      const processor = new KenBurnsProcessor(storage);
      await expect(
        processor.process(spec({ stillBytes: new Uint8Array([1, 2, 3]), role: "bad-still" })),
      ).rejects.toThrow();
      expect(failures[0]).toMatchObject({
        outcome: "failed",
        width: 32,
        height: 32,
        durationMs: 80,
      });
      expect(typeof failures[0]?.totalMs).toBe("number");
    } finally {
      logger.error = originalError;
    }
  });

  it("keeps the M4 manifest schema snapshot free of a render-time motion field", () => {
    expect(Object.keys(renderManifestSchema.shape).sort()).toEqual(
      [
        "audioMixNotes",
        "clips",
        "outputProfile",
        "rationale",
        "schemaVersion",
        "timelineId",
        "timelineVersion",
        "totalDurationMs",
      ].sort(),
    );
    expect(Object.keys(renderManifestClipSchema.shape).sort()).toEqual(
      [
        "captionText",
        "clipId",
        "sourceId",
        "sourceInMs",
        "sourceKind",
        "sourceOutMs",
        "storageKey",
        "timelineEndMs",
        "timelineStartMs",
        "trackKey",
        "transitionFromPrevious",
      ].sort(),
    );
  });
});
