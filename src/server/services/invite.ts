import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import { inviteOnlyEnabled } from "@/server/beta/flags";

export type InviteDecision = {
  allowed: true;
  inviteId: string | null;
  preVerifyEmail: boolean;
};

export type MintedInvite = {
  id: string;
  email: string | null;
  /** Plaintext shown once. Never persisted. */
  code: string | null;
  preVerifyEmail: boolean;
};

const pendingByEmail = new Map<string, InviteDecision>();

export class InviteService {
  constructor(private readonly inviteOnly: () => boolean = inviteOnlyEnabled) {}

  isInviteOnly() {
    return this.inviteOnly();
  }

  rememberPending(email: string, decision: InviteDecision) {
    pendingByEmail.set(normalizeEmail(email), decision);
  }

  peekPending(email: string): InviteDecision | undefined {
    return pendingByEmail.get(normalizeEmail(email));
  }

  clearPending(email: string) {
    pendingByEmail.delete(normalizeEmail(email));
  }

  async mintAllowlistEmail(email: string, note?: string): Promise<MintedInvite> {
    const normalized = normalizeEmail(email);
    const row = await prisma.betaInvite.create({
      data: {
        email: normalized,
        preVerifyEmail: true,
        note: note ?? null,
      },
    });
    logger.info("beta.invite_minted", { kind: "allowlist", inviteId: row.id });
    return {
      id: row.id,
      email: row.email,
      code: null,
      preVerifyEmail: row.preVerifyEmail,
    };
  }

  async mintCode(input: { email?: string; note?: string } = {}): Promise<MintedInvite> {
    const code = `yf_${randomBytes(18).toString("base64url")}`;
    const row = await prisma.betaInvite.create({
      data: {
        email: input.email ? normalizeEmail(input.email) : null,
        codeHash: hashInviteCode(code),
        preVerifyEmail: true,
        note: input.note ?? null,
      },
    });
    logger.info("beta.invite_minted", { kind: "code", inviteId: row.id });
    return {
      id: row.id,
      email: row.email,
      code,
      preVerifyEmail: row.preVerifyEmail,
    };
  }

  async assertCanRegister(input: {
    email: string;
    inviteCode?: string;
  }): Promise<InviteDecision> {
    if (!this.inviteOnly()) {
      return { allowed: true, inviteId: null, preVerifyEmail: false };
    }
    const email = normalizeEmail(input.email);
    if (!email) {
      throw AppError.validation("An email is required to register.");
    }

    const code = input.inviteCode?.trim();
    if (code) {
      const row = await prisma.betaInvite.findFirst({
        where: { codeHash: hashInviteCode(code), consumedAt: null },
      });
      if (!row) {
        throw AppError.forbidden("That invite code is not valid.");
      }
      if (row.email && row.email !== email) {
        throw AppError.forbidden("That invite code is not valid for this email.");
      }
      return { allowed: true, inviteId: row.id, preVerifyEmail: row.preVerifyEmail };
    }

    const allowlist = await prisma.betaInvite.findFirst({
      where: {
        email,
        codeHash: null,
        consumedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
    if (!allowlist) {
      throw AppError.forbidden("You need an invite to create an account.");
    }
    return {
      allowed: true,
      inviteId: allowlist.id,
      preVerifyEmail: allowlist.preVerifyEmail,
    };
  }

  async consumeForUser(input: {
    userId: string;
    email: string;
    inviteId: string | null;
  }): Promise<{ preVerifyEmail: boolean }> {
    if (!input.inviteId) {
      return { preVerifyEmail: false };
    }
    const inviteId = input.inviteId;
    try {
      return await this.attachInviteToUser({
        userId: input.userId,
        email: input.email,
        inviteId,
      });
    } catch (error) {
      await this.deleteOrphanSignup(input.userId);
      throw error;
    }
  }

  /**
   * YF-W1-03: if consume loses the race after Better Auth committed a user,
   * delete that user so we never leave an unverified leftover account.
   */
  async deleteOrphanSignup(userId: string) {
    await prisma.user.deleteMany({ where: { id: userId } });
    logger.info("beta.invite_orphan_deleted", { userId });
  }

  private async attachInviteToUser(input: {
    userId: string;
    email: string;
    inviteId: string;
  }): Promise<{ preVerifyEmail: boolean }> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM beta_invite WHERE id = ${input.inviteId} FOR UPDATE`;
      const existing = await tx.betaInvite.findUnique({
        where: { id: input.inviteId },
        select: { consumedByUserId: true, preVerifyEmail: true, consumedAt: true },
      });
      if (existing?.consumedByUserId === input.userId) {
        return { preVerifyEmail: existing.preVerifyEmail };
      }
      const row = await tx.betaInvite.updateMany({
        where: { id: input.inviteId, consumedAt: null },
        data: {
          consumedAt: new Date(),
          consumedByUserId: input.userId,
        },
      });
      if (row.count === 0) {
        throw AppError.forbidden("That invite is no longer available.");
      }
      const invite = await tx.betaInvite.findUniqueOrThrow({
        where: { id: input.inviteId },
        select: { preVerifyEmail: true },
      });
      if (invite.preVerifyEmail) {
        await tx.user.update({
          where: { id: input.userId },
          data: { emailVerified: true },
        });
        logger.info("beta.invite_preverified", {
          userId: input.userId,
          email: normalizeEmail(input.email),
        });
      }
      return { preVerifyEmail: invite.preVerifyEmail };
    });
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashInviteCode(code: string) {
  return createHash("sha256").update(`youflicks-invite:${code}`).digest("hex");
}
