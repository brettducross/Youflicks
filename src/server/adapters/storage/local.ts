import "server-only";

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaObject, StoragePort, StoredObjectMeta } from "@/server/ports/storage";
import { logger } from "@/lib/logger";

/**
 * Local filesystem storage. Suitable for development.
 * Production will swap this for an S3-compatible adapter behind StoragePort.
 */
export class LocalStorageAdapter implements StoragePort {
  readonly driver = "local";

  constructor(private readonly rootDir: string) {}

  private resolve(key: string) {
    const normalized = key.replace(/^\/+/, "");
    if (normalized.includes("..")) {
      throw new Error("Invalid storage key.");
    }
    return path.resolve(this.rootDir, normalized);
  }

  async put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<StoredObjectMeta> {
    const filePath = this.resolve(input.key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
    logger.info("storage.put", {
      driver: this.driver,
      key: input.key,
      bytes: input.body.byteLength,
    });
    return {
      key: input.key,
      contentType: input.contentType,
      byteSize: input.body.byteLength,
    };
  }

  async get(key: string): Promise<MediaObject | null> {
    const filePath = this.resolve(key);
    try {
      const body = await readFile(filePath);
      return {
        key,
        body,
        contentType: "application/octet-stream",
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key);
    await rm(filePath, { force: true });
    logger.info("storage.delete", { driver: this.driver, key });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
