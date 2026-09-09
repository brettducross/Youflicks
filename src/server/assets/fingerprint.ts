import { createHash } from "node:crypto";
import type { AssetGeneratorInput } from "@/server/assets/input";

/**
 * Stable fingerprint of assembled AssetGeneratorInput.
 * Persist this hash; never persist the raw input payload.
 */
export function fingerprintAssetGeneratorInput(input: AssetGeneratorInput): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

export function fingerprintAssetBatchRequest(request: {
  projectId: string;
  timelineId: string;
  timelineVersion: number;
  roles: Array<{ role: string; storySceneId?: string; kind: string }>;
}): string {
  return createHash("sha256").update(stableStringify(request)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value !== "object") {
    return value;
  }
  if (value) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
