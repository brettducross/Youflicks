/**
 * Object storage port.
 *
 * Implementations must not leak vendor URLs into the domain model.
 * Persist the returned `key` on MediaAsset.storageKey / FinishedMovie.storageKey.
 */
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

export interface StoragePort {
  readonly driver: string;
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<StoredObjectMeta>;
  get(key: string): Promise<MediaObject | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
