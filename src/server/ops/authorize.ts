import { timingSafeEqual } from "node:crypto";

/**
 * Compares `Authorization` to `Bearer ${secret}` in constant time when the
 * buffers are the same length. A missing secret, a missing header, or a
 * length mismatch is unauthorized. Callers still answer 404 either way.
 */
export function opsBearerAuthorized(
  authorizationHeader: string | null,
  secret: string | undefined,
): boolean {
  const trimmed = secret?.trim() ?? "";
  if (trimmed.length === 0) {
    return false;
  }
  const expected = Buffer.from(`Bearer ${trimmed}`);
  const actual = Buffer.from(authorizationHeader ?? "");
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
