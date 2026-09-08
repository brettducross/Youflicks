import { createHash } from "node:crypto";
import type { CreativePlan } from "@/server/director/schema";
import type { StoryComposerInput } from "@/server/story/input";

/**
 * Stable fingerprint of assembled StoryComposerInput.
 * Persist this hash; never persist the raw input payload.
 */
export function fingerprintStoryComposerInput(input: StoryComposerInput): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

export function fingerprintCreativePlan(plan: CreativePlan): string {
  return createHash("sha256").update(stableStringify(plan)).digest("hex");
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
