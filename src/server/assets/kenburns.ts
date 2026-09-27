import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { AssetGeneratorInput } from "@/server/assets/input";
import { GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION, type GeneratedAssetDocument } from "@/server/assets/schema";
import { validateGeneratedAssetDocument } from "@/server/assets/validate";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import type { StoragePort } from "@/server/ports/storage";
import {
  DEFAULT_RENDER_OUTPUT_PROFILE,
  type RenderOutputProfile,
} from "@/server/render/schema";

/** Lock §4 processor. Compute only. Not a generative lane and not the local placeholder. */
export const KEN_BURNS_PROVIDER_KEY = "yf.kenburns.v1";
export const KEN_BURNS_FPS = 25;
export const KEN_BURNS_MIN_DURATION_MS = 2_000;
export const KEN_BURNS_MAX_DURATION_MS = 8_000;
export const KEN_BURNS_SCALE_FROM = 1;
export const KEN_BURNS_SCALE_TO = 1.08;
export const STATIC_SCALE_TO = 1;

export type KenBurnsTreatmentName = "KEN_BURNS" | "STATIC";

export type KenBurnsTreatmentParams = {
  processor: typeof KEN_BURNS_PROVIDER_KEY;
  treatment: KenBurnsTreatmentName;
  sourceMediaAssetId: string;
  durationMs: number;
  scaleFrom: number;
  scaleTo: number;
  panX: number;
  panY: number;
  panAnchor: "center" | "face";
  width: number;
  height: number;
  outputProfile: RenderOutputProfile;
};

export type KenBurnsRenderSpec = KenBurnsTreatmentParams & {
  projectId: string;
  role: string;
  storySceneId?: string;
  timelineId: string;
  timelineVersion: number;
  storyStructureId?: string;
  storyStructureVersion?: number;
  stillBytes: Uint8Array;
};

let ffmpegReady: boolean | null = null;

/** Sync probe. Cached for the process. A missing binary means the processor is not configured. */
export function ffmpegAvailable(): boolean {
  if (ffmpegReady !== null) {
    return ffmpegReady;
  }
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 1500 });
    ffmpegReady = true;
  } catch {
    ffmpegReady = false;
  }
  return ffmpegReady;
}

export function clampSlotDurationMs(slotDurationMs: number | null | undefined): number | null {
  if (slotDurationMs == null || !Number.isInteger(slotDurationMs) || slotDurationMs <= 0) {
    return null;
  }
  return Math.min(KEN_BURNS_MAX_DURATION_MS, Math.max(KEN_BURNS_MIN_DURATION_MS, slotDurationMs));
}

/** Pixel size of a YouFlicks render profile. Matches the renderer's profile sizes. */
export function renderProfilePixels(profile: RenderOutputProfile): { width: number; height: number } {
  switch (profile) {
    case "WEB_720":
      return { width: 1280, height: 720 };
    case "WEB_1080":
    case "MASTER":
      return { width: 1920, height: 1080 };
    default: {
      const exhaustive: never = profile;
      return exhaustive;
    }
  }
}

export function buildKenBurnsParams(input: {
  treatment: KenBurnsTreatmentName;
  sourceMediaAssetId: string;
  slotDurationMs: number | null;
  panX: number;
  panY: number;
  panAnchor: "center" | "face";
  outputProfile?: RenderOutputProfile;
}): KenBurnsTreatmentParams | null {
  const durationMs = clampSlotDurationMs(input.slotDurationMs);
  if (durationMs == null) {
    return null;
  }
  const outputProfile = input.outputProfile ?? DEFAULT_RENDER_OUTPUT_PROFILE;
  const size = renderProfilePixels(outputProfile);
  return {
    processor: KEN_BURNS_PROVIDER_KEY,
    treatment: input.treatment,
    sourceMediaAssetId: input.sourceMediaAssetId,
    durationMs,
    scaleFrom: KEN_BURNS_SCALE_FROM,
    scaleTo: input.treatment === "STATIC" ? STATIC_SCALE_TO : KEN_BURNS_SCALE_TO,
    panX: input.panX,
    panY: input.panY,
    panAnchor: input.panAnchor,
    width: size.width,
    height: size.height,
    outputProfile,
  };
}

/**
 * Production MEDIA_ENHANCEMENT processor. Writes an H.264 mp4 with no audio
 * through StoragePort. generate() is not the path: AssetGeneratorInput has no
 * treatment params, and this class does not invent placeholder bytes.
 */
export class KenBurnsProcessor implements AssetGeneratorPort {
  constructor(private readonly storage: StoragePort) {}

  async generate(input: AssetGeneratorInput): Promise<GeneratedAssetDocument> {
    void input;
    throw new Error(
      `${KEN_BURNS_PROVIDER_KEY} does not accept a generative AssetGeneratorInput.`,
    );
  }

  async process(spec: KenBurnsRenderSpec): Promise<GeneratedAssetDocument> {
    const bytes = await encodeKenBurns(spec);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `projects/${spec.projectId}/generated/${spec.role}/${checksum.slice(0, 16)}/original.mp4`;
    await this.storage.put({
      key: storageKey,
      body: bytes,
      contentType: "video/mp4",
    });
    return validateGeneratedAssetDocument({
      schemaVersion: GENERATED_ASSET_DOCUMENT_SCHEMA_VERSION,
      kind: "ENHANCEMENT",
      role: spec.role,
      mimeType: "video/mp4",
      durationMs: spec.durationMs,
      width: spec.width,
      height: spec.height,
      checksum,
      storageKey,
      origin: "PROCESSED",
      sourceMediaAssetId: spec.sourceMediaAssetId,
      fulfillment: {
        timelineId: spec.timelineId,
        timelineVersion: spec.timelineVersion,
        storySceneId: spec.storySceneId,
      },
      source: {
        storyStructureId: spec.storyStructureId,
        storyStructureVersion: spec.storyStructureVersion,
      },
      rationale: "Silent picture from the source still at the project render profile. Provider yf.kenburns.v1.",
    });
  }
}

export function isKenBurnsProcessor(value: AssetGeneratorPort): value is KenBurnsProcessor {
  return value instanceof KenBurnsProcessor;
}

async function encodeKenBurns(spec: KenBurnsRenderSpec): Promise<Uint8Array> {
  if (!ffmpegAvailable()) {
    throw new Error(`${KEN_BURNS_PROVIDER_KEY} is not configured.`);
  }
  const base = await sharp(spec.stillBytes, { failOn: "none" })
    .rotate()
    .resize(spec.width, spec.height, { fit: "cover", position: "centre" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const frames = Math.max(1, Math.round((spec.durationMs / 1000) * KEN_BURNS_FPS));
  const dir = await mkdtemp(path.join(tmpdir(), "youflicks-kb-"));
  const rawPath = path.join(dir, "frames.rgb");
  const outPath = path.join(dir, "out.mp4");
  try {
    const handle = await open(rawPath, "w");
    try {
      for (let index = 0; index < frames; index += 1) {
        const t = frames === 1 ? 0 : index / (frames - 1);
        const scale = spec.scaleFrom + (spec.scaleTo - spec.scaleFrom) * t;
        const frame = await renderFrame(base, spec.width, spec.height, spec.panX, spec.panY, scale);
        await handle.write(frame);
      }
    } finally {
      await handle.close();
    }
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${spec.width}x${spec.height}`,
      "-r",
      String(KEN_BURNS_FPS),
      "-i",
      rawPath,
      "-frames:v",
      String(frames),
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-threads",
      "1",
      "-x264-params",
      "bframes=0:keyint=25:min-keyint=25:scenecut=0",
      "-fflags",
      "+bitexact",
      "-flags",
      "+bitexact",
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      outPath,
    ]);
    const encoded = await readFile(outPath);
    if (encoded.byteLength === 0) {
      throw new Error(`${KEN_BURNS_PROVIDER_KEY} wrote an empty file.`);
    }
    return new Uint8Array(encoded);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function renderFrame(
  base: Buffer,
  width: number,
  height: number,
  panX: number,
  panY: number,
  scale: number,
): Promise<Buffer> {
  const zoom = scale > 0 ? scale : 1;
  const winW = Math.min(width, Math.max(2, Math.round(width / zoom)));
  const winH = Math.min(height, Math.max(2, Math.round(height / zoom)));
  const cx = clampUnit(panX) * width;
  const cy = clampUnit(panY) * height;
  const left = clampInt(Math.round(cx - winW / 2), 0, width - winW);
  const top = clampInt(Math.round(cy - winH / 2), 0, height - winH);
  return sharp(base, { raw: { width, height, channels: 3 } })
    .extract({ left, top, width: winW, height: winH })
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${KEN_BURNS_PROVIDER_KEY} timed out.`));
    }, 120_000);
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").slice(0, 400);
      reject(new Error(`${KEN_BURNS_PROVIDER_KEY} exited ${code}: ${detail}`));
    });
  });
}
