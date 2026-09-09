import "server-only";

import { prisma } from "@/server/db";
import type { AbuseSignalPort } from "@/server/ports/abuse-signal";

export class PrismaAbuseSignalAdapter implements AbuseSignalPort {
  async isQuarantined(userId: string): Promise<boolean> {
    const state = await prisma.accountPlatformState.findUnique({
      where: { userId },
      select: { quarantined: true },
    });
    return state?.quarantined === true;
  }

  async setQuarantined(
    userId: string,
    quarantined: boolean,
    reason?: string | null,
  ): Promise<void> {
    await prisma.accountPlatformState.upsert({
      where: { userId },
      create: { userId, quarantined, reason: reason ?? null },
      update: { quarantined, reason: reason ?? null },
    });
  }
}
