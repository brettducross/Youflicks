/**
 * Object storage port.
 *
 * Implementations must not leak vendor URLs into the domain model.
 * Persist the returned `key` on MediaAsset.storageKey / GeneratedAsset.storageKey.
 * Never persist vendor URLs as domain truth.
 */
import type { Readable } from "node:stream";

export type MediaObject = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type StoredObjectMeta = {
  key: string;
  contentType: string;
  byteSize: number;
};

export type StorageReadRange = {
  start: number;
  end: number;
};

export type StorageStream = {
  stream: Readable;
  byteSize: number;
  contentLength: number;
  range?: StorageReadRange;
};

export interface StoragePort {
  readonly driver: string;
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<StoredObjectMeta>;
  get(key: string): Promise<MediaObject | null>;
  getStream(key: string, range?: StorageReadRange): Promise<StorageStream | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
