import { AppError } from "@/lib/errors";

/**
 * First-party sponsor / ad click destinations (YF-C01).
 * Fail-closed scheme allowlist: only absolute https URLs with a hostname.
 * Rejects http, javascript, data, relative, protocol-relative, credentials, and malformed.
 */
export function allowlistedHttpsLinkUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("//") || trimmed.startsWith("\\\\")) {
    return null;
  }
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!schemeMatch) {
    return null;
  }
  if (schemeMatch[1].toLowerCase() !== "https") {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  if (!parsed.hostname) {
    return null;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return null;
  }
  return parsed.href;
}

/** Ingest: omit/null stays non-clickable; any provided value must be allowlisted https. */
export function persistableSponsorLinkUrl(value?: string | null): string | null {
  if (value == null) {
    return null;
  }
  const allowed = allowlistedHttpsLinkUrl(value);
  if (!allowed) {
    throw AppError.validation("Sponsor link URLs must be https destinations.");
  }
  return allowed;
}
