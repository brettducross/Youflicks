import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";

describe("LocalStorageAdapter", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("puts, reads, and deletes through opaque keys", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-storage-"));
    const storage = new LocalStorageAdapter(dir);
    const key = "projects/p1/assets/a1/original.jpg";
    const body = new Uint8Array([1, 2, 3, 4]);

    const stored = await storage.put({
      key,
      body,
      contentType: "image/jpeg",
    });
    expect(stored.byteSize).toBe(4);
    expect(await storage.exists(key)).toBe(true);

    const read = await storage.get(key);
    expect(read?.body).toEqual(body);

    const stream = await storage.getStream(key, { start: 1, end: 2 });
    expect(stream?.contentLength).toBe(2);
    expect(stream?.range).toEqual({ start: 1, end: 2 });
    stream?.stream.destroy();

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it("rejects path traversal keys", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-storage-"));
    const storage = new LocalStorageAdapter(dir);
    await expect(
      storage.put({
        key: "../secret",
        body: new Uint8Array([1]),
        contentType: "text/plain",
      }),
    ).rejects.toThrow(/Invalid storage key/);
  });
});
