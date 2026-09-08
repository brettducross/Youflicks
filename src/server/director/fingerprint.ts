import { createHash } from "node:crypto";
import type { DirectorInput } from "@/server/director/input";

/**
 * Stable fingerprint of assembled Director input.
 * Persist this hash; never persist the raw input payload.
 */
export function fingerprintDirectorInput(input: DirectorInput): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
