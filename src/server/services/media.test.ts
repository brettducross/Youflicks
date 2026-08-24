import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { AppError } from "@/lib/errors";
import { ProjectStatus } from "@/server/domain/status";

const execFileAsync = promisify(execFile);

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("MediaService", () => {
  const ownerId = `test-owner-${Date.now()}`;
  const strangerId = `test-stranger-${Date.now()}`;
  let projectId = "";
  let dir = "";
  let media: MediaService;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-media-"));
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: false },
        { id: strangerId, name: "Stranger", email: `${strangerId}@example.com`, emailVerified: false },
      ],
    });
    const project = await new ProjectService().create(ownerId, {
      title: "Harbour tests",
      logline: "A reel for ingest tests.",
    });
    projectId = project.id;
    media = new MediaService(new LocalStorageAdapter(dir), new ProjectService());
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("ingests a photo through StoragePort and records metadata", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "still.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    expect(asset.kind).toBe("PHOTO");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.byteSize).toBe(PNG_1X1.byteLength);
    expect(asset.status).toBe("READY");
    expect(asset.width).toBe(1);
    expect(asset.height).toBe(1);
    expect(asset.previewUrl).toContain("variant=preview");
    expect(asset.originalUrl).toContain(`/api/projects/${projectId}/assets/${asset.id}/file`);
    expect(asset).not.toHaveProperty("storageKey");

    const listed = await media.listForProject(ownerId, projectId);
    expect(listed.some((entry) => entry.id === asset.id)).toBe(true);

    const stored = await media.getOwnedAsset(ownerId, projectId, asset.id);
    expect(stored.storageKey.startsWith(`projects/${projectId}/`)).toBe(true);
    expect(stored.checksum).toBeTruthy();

    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.status).toBe(ProjectStatus.INGESTING);
  });

  it("sniffs bytes and ignores a lying filename", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "not-an-image.exe",
      bytes: new Uint8Array(PNG_1X1),
    });
    expect(asset.mimeType).toBe("image/png");
    expect(asset.kind).toBe("PHOTO");
  });

  it("rejects disallowed types before creating a row", async () => {
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );
    await expect(
      media.ingest(ownerId, projectId, {
        filename: "loop.gif",
        bytes: new Uint8Array(gif),
      }),
    ).rejects.toBeInstanceOf(AppError);
    const leftover = await prisma.mediaAsset.findFirst({
      where: { projectId, filename: "loop.gif" },
    });
    expect(leftover).toBeNull();
  });

  it("enforces image size limits after sniffing kind", async () => {
    const tight = new MediaService(new LocalStorageAdapter(dir), new ProjectService(), {
      maxImageBytes: 10,
      maxVideoBytes: 512 * 1024 * 1024,
    });
    await expect(
      tight.ingest(ownerId, projectId, {
        filename: "huge.png",
        bytes: new Uint8Array(PNG_1X1),
      }),
    ).rejects.toThrow(/Photos must be/);
  });

  it("ingests a small MP4 and records duration when ffmpeg is available", async () => {
    const dest = path.join(dir, "tiny.mp4");
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=16x16:d=0.3",
        "-pix_fmt",
        "yuv420p",
        dest,
      ]);
    } catch {
      return;
    }
    const bytes = new Uint8Array(await readFile(dest));
    const asset = await media.ingest(ownerId, projectId, {
      filename: "slate.mp4",
      bytes,
    });
    expect(asset.kind).toBe("VIDEO");
    expect(asset.mimeType).toBe("video/mp4");
    expect(asset.durationMs).toBeGreaterThan(0);
    expect(asset.previewUrl).toBeTruthy();
  });

  it("rejects ingest from a user who does not own the project", async () => {
    await expect(
      media.ingest(strangerId, projectId, {
        filename: "stolen.png",
        bytes: new Uint8Array(PNG_1X1),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("does not list another user's project media", async () => {
    await expect(media.listForProject(strangerId, projectId)).rejects.toBeInstanceOf(AppError);
  });

  it("removes an owned asset from the database and storage", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "to-delete.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const stored = await media.getOwnedAsset(ownerId, projectId, asset.id);
    await media.remove(ownerId, projectId, asset.id);
    await expect(media.getOwnedAsset(ownerId, projectId, asset.id)).rejects.toBeInstanceOf(AppError);
    expect(await new LocalStorageAdapter(dir).exists(stored.storageKey)).toBe(false);
  });

  it("refuses to open another user's asset", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "private.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    await expect(
      media.openFile(strangerId, projectId, asset.id, "original"),
    ).rejects.toBeInstanceOf(AppError);
  });
});
