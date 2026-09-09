-- M7: harden Publication as an explicit share/export attempt against one READY FinishedMovie.
-- Status PENDING | PUBLISHED | FAILED | REVOKED. destinationKey stays an open string.
-- Payload is YouFlicks-owned (expiresAt, revokedAt, tokenFingerprint) — never raw secrets.

ALTER TABLE "publication" ADD COLUMN "publishedAt" TIMESTAMP(3);

CREATE INDEX "publication_movieId_status_idx" ON "publication"("movieId", "status");
