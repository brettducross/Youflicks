import "server-only";

import { logger } from "@/lib/logger";
import type {
  VerificationEmailMessage,
  VerificationEmailPort,
} from "@/server/ports/verification-email";

/**
 * Development / default adapter. Does not bind a vendor.
 * Production deliverability requires a later email adapter (ops).
 */
export class LogVerificationEmailAdapter implements VerificationEmailPort {
  readonly providerKey = "youflicks.log.email";

  async send(message: VerificationEmailMessage): Promise<void> {
    const production = process.env.NODE_ENV === "production";
    logger.info("account.verification_email_queued", {
      userId: message.userId,
      providerKey: this.providerKey,
    });
    if (!production) {
      logger.info("account.verification_email_local", {
        userId: message.userId,
        url: message.url,
      });
    }
  }
}

export class NoneVerificationEmailAdapter implements VerificationEmailPort {
  readonly providerKey = "youflicks.none.email";

  async send(): Promise<void> {
    // Path B / no-send. Invite mint pre-verifies. Never log a verify URL in production.
  }
}

const logAdapter = new LogVerificationEmailAdapter();
const noneAdapter = new NoneVerificationEmailAdapter();

export function getVerificationEmailAdapter(): VerificationEmailPort {
  if (process.env.EMAIL_DRIVER === "none") {
    return noneAdapter;
  }
  return logAdapter;
}
