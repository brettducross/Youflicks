import { AppError } from "@/lib/errors";
import type { DirectorInput } from "@/server/director/input";

const FORBIDDEN_KEYS = [
  "apiKey",
  "authorization",
  "password",
  "token",
  "ANALYSIS_HTTP_API_KEY",
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
  "notes",
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

/** Director input must be a minimized YouFlicks brief. */
export function assertDirectorInputPrivacy(input: DirectorInput) {
  const hits: string[] = [];
  walk(input, "directorInput", hits);
  if (hits.length > 0) {
    throw AppError.directorInputInvalid(
      "Director input contains private or sponsor fields that must not be sent.",
      { paths: hits },
    );
  }
}

export function isIgnoreGeneralTaste(extras: Record<string, unknown> | null) {
  return extras?.ignoreGeneralTaste === true;
}
