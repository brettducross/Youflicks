import "server-only";

import { prisma } from "@/server/db";
import type { RateLimitPort, RateLimitRecordInput } from "@/server/ports/rate-limit";

export class PrismaRateLimitAdapter implements RateLimitPort {
  async countInWindow(userId: string, kind: string, since: Date): Promise<number> {
    return prisma.generationAuthorization.count({
      where: { userId, kind, recordedAt: { gte: since } },
    });
  }

  async record(input: RateLimitRecordInput): Promise<void> {
    await prisma.generationAuthorization.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        projectId: input.projectId,
        recordedAt: input.recordedAt,
      },
    });
  }
}
