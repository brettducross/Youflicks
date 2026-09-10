import type { NormalizedAssetMeta } from "@/server/gateways/yf-asset/jobs";

export type DownloadedAsset = {
  bytes: Uint8Array;
  mimeType: string;
  durationMs?: number;
  width?: number;
  height?: number;
};

export async function downloadNormalizedAsset(
  asset: NormalizedAssetMeta,
  options: { maxBytes: number; fetchImpl?: typeof fetch } = { maxBytes: 100 * 1024 * 1024 },
): Promise<DownloadedAsset> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(asset.url);
  if (!response.ok) {
    throw new Error(`Asset download failed (${response.status}).`);
  }
  const mimeType =
    asset.mimeType ??
    response.headers.get("content-type")?.split(";")[0]?.trim() ??
    guessMimeFromUrl(asset.url);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error("Asset download returned empty bytes.");
  }
  if (buffer.byteLength > options.maxBytes) {
    throw new Error("Asset download exceeded YF_GATEWAY_DOWNLOAD_MAX_BYTES.");
  }
  return {
    bytes: buffer,
    mimeType,
    durationMs: asset.durationMs,
    width: asset.width,
    height: asset.height,
  };
}

function guessMimeFromUrl(url: string): string {
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.jpe?g(\?|$)/i.test(url)) return "image/jpeg";
  if (/\.webm(\?|$)/i.test(url)) return "video/webm";
  return "video/mp4";
}
