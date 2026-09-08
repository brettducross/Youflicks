import { AppError } from "@/lib/errors";
import type { StoryComposerInput } from "@/server/story/input";

const FORBIDDEN_KEYS = [
  "apiKey",
  "authorization",
  "password",
  "token",
  "ANALYSIS_HTTP_API_KEY",
  "STORY_HTTP_API_KEY",
  "sponsor",
  "sponsors",
  "campaign",
  "offer",
  "placement",
  "email",
  "userId",
  "storageKey",
  "previewKey",
  "tasteProfile",
  "signals",
  "startMs",
  "endMs",
  "clips",
  "clipList",
  "clipIds",
  "tracks",
  "transitions",
  "render",
  "renderSpec",
  "ffmpeg",
  "codec",
  "timeline",
  "timelineClip",
  "hostJson",
  "providerPayload",
  "rawHost",
];

function walk(value: unknown, path: string, hits: string[]) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, hits));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      hits.push(`${path}.${key}`);
    }
    walk(child, `${path}.${key}`, hits);
  }
}

/** Story composer input must be a minimized YouFlicks brief. */
export function assertStoryComposerInputPrivacy(input: StoryComposerInput) {
  const hits: string[] = [];
  walk(input, "storyComposerInput", hits);
  if (hits.length > 0) {
    throw AppError.storyInputInvalid(
      "Story composer input contains private, sponsor, or editorial fields that must not be sent.",
      { paths: hits },
    );
  }
}

/**
 * Reject timing, clip-list, track, transition, render, or provider-host
 * smuggling anywhere in a StoryDocument payload.
 */
export function assertNoSmuggledEditorialFields(value: unknown) {
  const hits: string[] = [];
  walk(value, "storyDocument", hits);
  const editorial = hits.filter((path) =>
    /startMs|endMs|clips|clipList|clipIds|tracks|transitions|render|ffmpeg|codec|timeline|hostJson|providerPayload|rawHost/.test(
      path,
    ),
  );
  if (editorial.length > 0) {
    throw AppError.storyDocumentInvalid(
      "Story documents must not include editorial timing, clip lists, tracks, transitions, render, or provider-host fields.",
      { paths: editorial },
    );
  }
}
