import { z } from "zod";

/**
 * ShotFulfillment.identityEvidence write boundary.
 * Closed shape: an allowlist of count/boolean fields, one nested object of
 * the same fields, integers in 0..10000. Never embeddings, face crops,
 * image bytes, base64, or open key sets.
 */

export class IdentityEvidenceError extends Error {
  readonly code = "IDENTITY_EVIDENCE_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "IdentityEvidenceError";
  }
}

/** Counts stay small so an int-quantized embedding cannot hide in a number. */
const MAX_IDENTITY_COUNT = 10_000;

const countSchema = z.number().int().nonnegative().max(MAX_IDENTITY_COUNT);

const identityEvidenceFields = {
  faceCount: countSchema.optional(),
  faceDetected: z.boolean().optional(),
  recurringPersonCount: countSchema.optional(),
  analysisCompleted: z.boolean().optional(),
};

/** One level only. A nested `detail` cannot itself contain `detail`. */
const identityEvidenceLeafSchema = z.strictObject(identityEvidenceFields);

const identityEvidenceSchema = z.strictObject({
  ...identityEvidenceFields,
  detail: identityEvidenceLeafSchema.optional(),
});

/**
 * Accepts only the allowlisted identityEvidence shape.
 * Rejects unknown keys, arrays, strings, bytes, floats, and deeper nesting.
 */
export function assertIdentityEvidence(value: unknown): Record<string, unknown> {
  const parsed = identityEvidenceSchema.safeParse(value);
  if (!parsed.success) {
    throw new IdentityEvidenceError(
      "identityEvidence must be an allowlisted object of bounded counts and booleans.",
    );
  }
  return parsed.data as Record<string, unknown>;
}
