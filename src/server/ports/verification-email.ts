/**
 * Provider-neutral verification email delivery.
 * Adapters may log, SMTP, or a vendor — domain never stores a vendor enum.
 */
export type VerificationEmailMessage = {
  to: string;
  userId: string;
  url: string;
  subject: string;
  text: string;
};

export type VerificationEmailPort = {
  /** Open string provenance key. Never a Prisma vendor enum. */
  providerKey: string;
  send(message: VerificationEmailMessage): Promise<void>;
};
