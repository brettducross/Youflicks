/**
 * ShotFulfillment.identityEvidence write boundary.
 * Counts and booleans only. Never embeddings, face crops, image bytes, or base64.
 */

export class IdentityEvidenceError extends Error {
  readonly code = "IDENTITY_EVIDENCE_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "IdentityEvidenceError";
  }
}

const BASE64_TEXT = /^(?:[A-Za-z0-9+/]{4}){4,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Accepts a plain object whose leaves are booleans or non-negative integer counts.
 * Rejects float arrays (embeddings), binary image bytes, and base64 text.
 */
export function assertIdentityEvidence(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new IdentityEvidenceError(
      "identityEvidence must be an object of counts and booleans.",
    );
  }
  walk(value, "identityEvidence");
  return value;
}

function walk(value: unknown, path: string): void {
  if (typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new IdentityEvidenceError(
        `${path} must be a non-negative integer count, not a float or embedding component.`,
      );
    }
    return;
  }
  if (typeof value === "string") {
    if (value.startsWith("data:image/") || BASE64_TEXT.test(value)) {
      throw new IdentityEvidenceError(
        `${path} must not contain base64 or image data.`,
      );
    }
    throw new IdentityEvidenceError(
      `${path} must be a count or boolean, not text.`,
    );
  }
  if (isBinary(value)) {
    throw new IdentityEvidenceError(`${path} must not contain image bytes.`);
  }
  if (Array.isArray(value)) {
    const floats = value.some((item) => typeof item === "number");
    throw new IdentityEvidenceError(
      floats
        ? `${path} must not contain float arrays or embeddings.`
        : `${path} must not contain arrays.`,
    );
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) {
        throw new IdentityEvidenceError(`${path}.${key} must be a count or boolean.`);
      }
      walk(child, `${path}.${key}`);
    }
    return;
  }
  throw new IdentityEvidenceError(`${path} must be a count or boolean.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBinary(value: unknown): boolean {
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
  );
}
