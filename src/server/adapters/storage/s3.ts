import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { logger } from "@/lib/logger";
import { reportOpsAlert, OpsAlertKind } from "@/lib/ops-alerts";
import type {
  MediaObject,
  StoragePort,
  StorageReadRange,
  StorageStream,
  StoredObjectMeta,
} from "@/server/ports/storage";

export type S3CompatibleConfig = {
  driver: "r2" | "s3";
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

export type S3ObjectStore = {
  putObject(input: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
  getObject(input: {
    key: string;
    range?: StorageReadRange;
  }): Promise<{ body: Uint8Array; contentType: string; byteSize: number } | null>;
  deleteObject(key: string): Promise<void>;
  headObject(key: string): Promise<{ byteSize: number; contentType: string } | null>;
};

export function assertOpaqueStorageKey(key: string) {
  const normalized = key.replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("://") ||
    normalized.startsWith("/")
  ) {
    throw new Error("Invalid storage key.");
  }
  return normalized;
}

export class MemoryS3ObjectStore implements S3ObjectStore {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async putObject(input: { key: string; body: Uint8Array; contentType: string }) {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType });
  }

  async getObject(input: { key: string; range?: StorageReadRange }) {
    const object = this.objects.get(input.key);
    if (!object) return null;
    if (!input.range) {
      return { ...object, byteSize: object.body.byteLength };
    }
    const start = Math.max(0, input.range.start);
    const end = Math.min(object.body.byteLength - 1, input.range.end);
    if (start > end) return null;
    return {
      body: object.body.slice(start, end + 1),
      contentType: object.contentType,
      byteSize: object.body.byteLength,
    };
  }

  async deleteObject(key: string) {
    this.objects.delete(key);
  }

  async headObject(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return { byteSize: object.body.byteLength, contentType: object.contentType };
  }
}

export class AwsS3ObjectStore implements S3ObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putObject(input: { key: string; body: Uint8Array; contentType: string }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  async getObject(input: { key: string; range?: StorageReadRange }) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Range: input.range ? `bytes=${input.range.start}-${input.range.end}` : undefined,
        }),
      );
      const bytes = result.Body ? await result.Body.transformToByteArray() : new Uint8Array();
      const total = Number(result.ContentRange?.split("/")[1] ?? result.ContentLength ?? bytes.byteLength);
      return {
        body: bytes,
        contentType: result.ContentType ?? "application/octet-stream",
        byteSize: Number.isFinite(total) ? total : bytes.byteLength,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async headObject(key: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        byteSize: result.ContentLength ?? 0,
        contentType: result.ContentType ?? "application/octet-stream",
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

/**
 * S3-compatible StoragePort (Cloudflare R2 or generic S3).
 * Persists opaque keys only — never vendor URLs.
 */
export class S3CompatibleStorageAdapter implements StoragePort {
  readonly driver: "r2" | "s3";

  constructor(
    private readonly store: S3ObjectStore,
    driver: "r2" | "s3" = "s3",
  ) {
    this.driver = driver;
  }

  async put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<StoredObjectMeta> {
    const key = assertOpaqueStorageKey(input.key);
    try {
      await this.store.putObject({ key, body: input.body, contentType: input.contentType });
    } catch (error) {
      await reportOpsAlert({
        kind: OpsAlertKind.STORAGE_ERROR,
        message: "Object store put failed.",
        context: { driver: this.driver, key, error: error instanceof Error ? error.message : "unknown" },
      });
      throw error;
    }
    logger.info("storage.put", {
      driver: this.driver,
      key,
      bytes: input.body.byteLength,
    });
    return {
      key,
      contentType: input.contentType,
      byteSize: input.body.byteLength,
    };
  }

  async get(key: string): Promise<MediaObject | null> {
    const opaque = assertOpaqueStorageKey(key);
    const object = await this.store.getObject({ key: opaque });
    if (!object) return null;
    return { key: opaque, body: object.body, contentType: object.contentType };
  }

  async getStream(key: string, range?: StorageReadRange): Promise<StorageStream | null> {
    const opaque = assertOpaqueStorageKey(key);
    const object = await this.store.getObject({ key: opaque, range });
    if (!object) return null;
    if (!range) {
      return {
        stream: Readable.from(Buffer.from(object.body)),
        byteSize: object.byteSize,
        contentLength: object.body.byteLength,
      };
    }
    const start = Math.max(0, range.start);
    const end = Math.min(object.byteSize - 1, range.end);
    return {
      stream: Readable.from(Buffer.from(object.body)),
      byteSize: object.byteSize,
      contentLength: object.body.byteLength,
      range: { start, end },
    };
  }

  async delete(key: string): Promise<void> {
    const opaque = assertOpaqueStorageKey(key);
    try {
      await this.store.deleteObject(opaque);
    } catch (error) {
      await reportOpsAlert({
        kind: OpsAlertKind.STORAGE_ERROR,
        message: "Object store delete failed.",
        context: { driver: this.driver, key: opaque, error: error instanceof Error ? error.message : "unknown" },
      });
      throw error;
    }
    logger.info("storage.delete", { driver: this.driver, key: opaque });
  }

  async exists(key: string): Promise<boolean> {
    const opaque = assertOpaqueStorageKey(key);
    return Boolean(await this.store.headObject(opaque));
  }
}

export function createAwsS3Store(config: S3CompatibleConfig): AwsS3ObjectStore {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return new AwsS3ObjectStore(client, config.bucket);
}

function isNotFound(error: unknown) {
  const name = (error as { name?: string } | undefined)?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
    ?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}
