import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { logger } from "@/lib/logger";
import { MediaKind } from "@/server/media/constants";

export type MediaProbe = {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  previewJpeg: Uint8Array | null;
};

const PREVIEW_WIDTH = 720;

function run(command: string, args: string[], timeoutMs = 20_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) {
        resolve(result);
        return;
      }
      reject(new Error(`${command} exited ${code}: ${result.stderr.slice(0, 400)}`));
    });
  });
}

async function probeImage(bytes: Uint8Array): Promise<MediaProbe> {
  try {
    const image = sharp(bytes, { failOn: "none" }).rotate();
    const meta = await image.metadata();
    const previewJpeg = await image
      .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    return {
      width: meta.width ?? null,
      height: meta.height ?? null,
      durationMs: null,
      previewJpeg,
    };
  } catch (error) {
    logger.warn("media.preview.image_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { width: null, height: null, durationMs: null, previewJpeg: null };
  }
}

type FfprobeJson = {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    duration?: string;
  }>;
};

async function probeVideo(bytes: Uint8Array, extension: string): Promise<MediaProbe> {
  const dir = await mkdtemp(path.join(tmpdir(), "youflicks-probe-"));
  const source = path.join(dir, `source${extension}`);
  const poster = path.join(dir, "poster.jpg");
  try {
    await writeFile(source, bytes);
    const probed = await run("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      source,
    ]);
    const json = JSON.parse(probed.stdout) as FfprobeJson;
    const videoStream = json.streams?.find((stream) => stream.codec_type === "video");
    const durationSec = Number(json.format?.duration ?? videoStream?.duration ?? NaN);
    const durationMs = Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : null;

    let previewJpeg: Uint8Array | null = null;
    try {
      const seek = durationMs && durationMs > 1200 ? "0.4" : "0";
      await run("ffmpeg", [
        "-y",
        "-ss",
        seek,
        "-i",
        source,
        "-frames:v",
        "1",
        "-vf",
        `scale=${PREVIEW_WIDTH}:-2`,
        "-q:v",
        "4",
        poster,
      ]);
      previewJpeg = await readFile(poster);
    } catch (error) {
      logger.warn("media.preview.video_poster_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }

    return {
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
      durationMs,
      previewJpeg,
    };
  } catch (error) {
    logger.warn("media.preview.video_probe_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { width: null, height: null, durationMs: null, previewJpeg: null };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function probeAndPreview(input: {
  bytes: Uint8Array;
  kind: string;
  extension: string;
}): Promise<MediaProbe> {
  if (input.kind === MediaKind.PHOTO) {
    return probeImage(input.bytes);
  }
  if (input.kind === MediaKind.VIDEO) {
    return probeVideo(input.bytes, input.extension);
  }
  return { width: null, height: null, durationMs: null, previewJpeg: null };
}
