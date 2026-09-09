import { createHash } from "node:crypto";
import type { RenderComposerInput } from "@/server/render/input";
import type { RenderManifest } from "@/server/render/schema";

/**
 * Stable fingerprint of assembled render input (manifest + identity).
 * destinationKeyHint is per-job and is excluded so identical open work
 * can be idempotent. Persist this hash; do not persist raw composer input.
 */
export function fingerprintRenderComposerInput(input: RenderComposerInput): string {
  return fingerprintRenderRequest({
    projectId: input.projectId,
    timelineId: input.timelineId,
    timelineVersion: input.timelineVersion,
    outputProfile: input.outputProfile,
    manifest: input.manifest,
  });
}

export function fingerprintRenderRequest(input: {
  projectId: string;
  timelineId: string;
  timelineVersion: number;
  outputProfile: string;
  manifest: RenderManifest;
}): string {
  return createHash("sha256")
    .update(
      stableStringify({
        projectId: input.projectId,
        timelineId: input.timelineId,
        timelineVersion: input.timelineVersion,
        outputProfile: input.outputProfile,
        manifest: input.manifest,
      }),
    )
    .digest("hex");
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
