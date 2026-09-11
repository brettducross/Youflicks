import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { fingerprintShareToken } from "@/server/publication/fingerprint";
import {
  SHARE_LINK_DEFAULT_TTL_MS,
  SHARE_LINK_MAX_TTL_MS,
} from "@/server/publication/schema";

export type ShareTokenClaims = {
  publicationId: string;
  movieId: string;
  issuedAt: number;
  expiresAt: number;
};

type TokenPayload = {
  v: 1;
  pub: string;
  mid: string;
  iat: number;
  exp: number;
  nonce: string;
};

/**
 * Empty or unset SHARE_TOKEN_SECRET disables share (fail-closed).
 * Do not fall back to BETTER_AUTH_SECRET.
 */
export function resolveShareSigningSecret(shareTokenSecret: string | undefined): string {
  return shareTokenSecret?.trim() ?? "";
}

export function isShareTokenSecretConfigured(shareTokenSecret: string | undefined): boolean {
  return resolveShareSigningSecret(shareTokenSecret).length >= 16;
}

/**
 * Time-limited, revocable SHARE_LINK tokens.
 * Runtime only — the durable record is tokenFingerprint on Publication.payload.
 */
export class ShareTokenStore {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = () => Date.now(),
    private readonly defaultTtlMs: number = SHARE_LINK_DEFAULT_TTL_MS,
  ) {}

  get configured() {
    return this.secret.trim().length >= 16;
  }

  issue(input: { publicationId: string; movieId: string; expiresAt?: Date }): {
    token: string;
    claims: ShareTokenClaims;
    fingerprint: string;
  } {
    if (!this.configured) {
      throw AppError.publicationDestinationUnavailable("Share links are not configured.");
    }
    const issuedAt = this.now();
    const expiresAt = this.resolveExpiry(input.expiresAt, issuedAt);
    const payload: TokenPayload = {
      v: 1,
      pub: input.publicationId,
      mid: input.movieId,
      iat: issuedAt,
      exp: expiresAt,
      nonce: randomBytes(16).toString("base64url"),
    };
    const token = this.sign(payload);
    return {
      token,
      claims: {
        publicationId: input.publicationId,
        movieId: input.movieId,
        issuedAt,
        expiresAt,
      },
      fingerprint: fingerprintShareToken(token),
    };
  }

  verify(token: string): ShareTokenClaims {
    if (!this.configured) {
      throw AppError.publicationDestinationUnavailable("Share links are not configured.");
    }
    const parts = token.split(".");
    if (parts.length !== 2) {
      throw AppError.publicationTokenInvalid();
    }
    const [body, sig] = parts;
    const expected = this.hmac(body);
    const actual = Buffer.from(sig, "base64url");
    const wanted = Buffer.from(expected, "base64url");
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      throw AppError.publicationTokenInvalid();
    }
    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    } catch {
      throw AppError.publicationTokenInvalid();
    }
    if (payload.v !== 1 || !payload.pub || !payload.mid || !payload.exp || !payload.iat) {
      throw AppError.publicationTokenInvalid();
    }
    if (payload.exp <= this.now()) {
      throw AppError.publicationTokenInvalid("That share link has expired.");
    }
    return {
      publicationId: payload.pub,
      movieId: payload.mid,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  }

  fingerprint(token: string) {
    return fingerprintShareToken(token);
  }

  resolveExpiry(expiresAt: Date | undefined, now = this.now()) {
    const max = now + SHARE_LINK_MAX_TTL_MS;
    const requested = expiresAt ? expiresAt.getTime() : now + this.defaultTtlMs;
    if (!Number.isFinite(requested) || requested <= now) {
      throw AppError.publicationInputInvalid("Share links need a future expiry.");
    }
    return Math.min(requested, max);
  }

  private sign(payload: TokenPayload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${body}.${this.hmac(body)}`;
  }

  private hmac(body: string) {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }
}
