/**
 * M8.1 account gate types. Email verification only.
 * Quotas, planKind, watermark, and ads belong in later M8 slices.
 */

export const AccountDenyCode = {
  EMAIL_UNVERIFIED: "EMAIL_UNVERIFIED",
} as const;

export type AccountDenyCodeValue = (typeof AccountDenyCode)[keyof typeof AccountDenyCode];

export type AccountGate = {
  userId: string;
  emailVerified: boolean;
  canGenerate: boolean;
  denyCode: AccountDenyCodeValue | null;
};

export type AuthorizeGenerationIntent = {
  requestedMaxDurationMs?: number;
  projectId?: string;
};

export type AuthorizeGenerationAllow = {
  allowed: true;
};

export type AuthorizeGenerationDeny = {
  allowed: false;
  code: AccountDenyCodeValue;
  message: string;
};

export type AuthorizeGenerationResult = AuthorizeGenerationAllow | AuthorizeGenerationDeny;

export type VerificationEmailRequest = {
  userId: string;
  email: string;
};

export type VerificationEmailRequestResult = {
  sent: boolean;
  alreadyVerified: boolean;
};
