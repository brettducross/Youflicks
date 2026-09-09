import { createHash } from "node:crypto";
import type { StoryDocument } from "@/server/story/schema";
import type { TimelineComposerInput } from "@/server/timeline/input";

/**
 * Stable fingerprint of assembled TimelineComposerInput.
 * Persist this hash; never persist the raw input payload.
 */
export function fingerprintTimelineComposerInput(input: TimelineComposerInput): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

export function fingerprintStoryDocument(story: StoryDocument): string {
  return createHash("sha256").update(stableStringify(story)).digest("hex");
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
