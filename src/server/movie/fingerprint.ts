import { createHash } from "node:crypto";

/** Optional keep fingerprint: source render outputKey + renderJobId. */
export function fingerprintLibraryKeep(input: { renderJobId: string; outputKey: string }) {
  return createHash("sha256")
    .update(`${input.outputKey}\n${input.renderJobId}`)
    .digest("hex");
}

export function checksumBytes(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}
