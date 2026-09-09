import "server-only";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import {
  AccountDenyCode,
  type AccountGate,
  type AuthorizeGenerationIntent,
  type AuthorizeGenerationResult,
  type VerificationEmailRequest,
  type VerificationEmailRequestResult,
} from "@/server/account/types";
export type AdapterAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canCompose: boolean;
};

export type GenerationHonesty = {
  canGenerate: boolean;
  emailVerified: boolean;
  generationDenyCode: AccountGate["denyCode"];
};

export type DirectorGenerationAvailability = AdapterAvailability & GenerationHonesty;

/**
 * M8.1 — Account lifecycle on Better Auth `User.emailVerified`.
 * authorizeGeneration is email-only; rate limits and entitlements are M8.2.
 */
export class AccountLifecycleService {
  constructor(
    private readonly requestSend: (input: VerificationEmailRequest) => Promise<void> = async () => {
      throw AppError.providerNotConfigured("VerificationEmailPort");
    },
  ) {}

  async getAccountGate(userId: string): Promise<AccountGate> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, emailVerified: true },
    });
    if (!user) {
      throw AppError.notFound("That account was not found.");
    }
    if (!user.emailVerified) {
      return {
        userId: user.id,
        emailVerified: false,
        canGenerate: false,
        denyCode: AccountDenyCode.EMAIL_UNVERIFIED,
      };
    }
    return {
      userId: user.id,
      emailVerified: true,
      canGenerate: true,
      denyCode: null,
    };
  }

  async authorizeGeneration(
    userId: string,
    intent: AuthorizeGenerationIntent = {},
  ): Promise<AuthorizeGenerationResult> {
    void intent;
    const gate = await this.getAccountGate(userId);
    if (!gate.emailVerified) {
      logger.info("account.generation_denied", {
        userId,
        code: AccountDenyCode.EMAIL_UNVERIFIED,
      });
      return {
        allowed: false,
        code: AccountDenyCode.EMAIL_UNVERIFIED,
        message: "Verify your email before starting a movie.",
      };
    }
    logger.info("account.generation_authorized", { userId });
    return { allowed: true };
  }

  async requireGeneration(userId: string, intent: AuthorizeGenerationIntent = {}) {
    const decision = await this.authorizeGeneration(userId, intent);
    if (!decision.allowed) {
      throw AppError.emailUnverified(decision.message);
    }
    return decision;
  }

  async requestVerificationEmail(userId: string): Promise<VerificationEmailRequestResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!user) {
      throw AppError.notFound("That account was not found.");
    }
    if (user.emailVerified) {
      return { sent: false, alreadyVerified: true };
    }
    await this.requestSend({ userId: user.id, email: user.email });
    logger.info("account.verification_email_requested", { userId: user.id });
    return { sent: true, alreadyVerified: false };
  }
}

export function withGenerationHonesty(
  availability: AdapterAvailability,
  gate: AccountGate,
): DirectorGenerationAvailability {
  return {
    ...availability,
    canGenerate: availability.canCompose && gate.canGenerate,
    emailVerified: gate.emailVerified,
    generationDenyCode: gate.denyCode,
  };
}
