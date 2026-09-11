import "server-only";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AI_CONSENT_POLICY_VERSION } from "@/server/beta/defaults";
import { prisma } from "@/server/db";

export class ConsentService {
  constructor(private readonly policyVersion: string = AI_CONSENT_POLICY_VERSION) {}

  currentPolicyVersion() {
    return this.policyVersion;
  }

  async hasAccepted(userId: string, policyVersion = this.policyVersion) {
    const row = await prisma.aiProcessingConsent.findUnique({
      where: { userId_policyVersion: { userId, policyVersion } },
      select: { id: true },
    });
    return Boolean(row);
  }

  async accept(userId: string, policyVersion = this.policyVersion) {
    const acceptedAt = new Date();
    const row = await prisma.aiProcessingConsent.upsert({
      where: { userId_policyVersion: { userId, policyVersion } },
      create: { userId, policyVersion, acceptedAt },
      update: { acceptedAt },
    });
    logger.info("consent.ai_accepted", { userId, policyVersion });
    return {
      policyVersion: row.policyVersion,
      acceptedAt: row.acceptedAt.toISOString(),
    };
  }

  async requireAccepted(userId: string, policyVersion = this.policyVersion) {
    if (await this.hasAccepted(userId, policyVersion)) {
      return;
    }
    throw AppError.consentRequired(
      "Accept AI processing terms before sending footage to a vendor.",
    );
  }
}
