import "server-only";

import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { getVerificationEmailAdapter } from "@/server/adapters/email/log-verification-email";
import { prisma } from "@/server/db";
import { InviteService } from "@/server/services/invite";

const verificationEmail = getVerificationEmailAdapter();
const invites = new InviteService();

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Session is allowed unverified; movie generation is gated separately (M8.1).
    requireEmailVerification: false,
  },
  emailVerification: {
    sendOnSignUp: env.EMAIL_DRIVER !== "none",
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      void verificationEmail.send({
        to: user.email,
        userId: user.id,
        url,
        subject: "Verify your YouFlicks email",
        text: `Confirm this email to start making movies on YouFlicks.\n\n${url}\n`,
      });
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") {
        return;
      }
      const body = ctx.body as { email?: string; inviteCode?: string } | undefined;
      try {
        const email = String(body?.email ?? "");
        const pending = invites.peekPending(email);
        const decision =
          pending ??
          (await invites.assertCanRegister({
            email,
            inviteCode: body?.inviteCode,
          }));
        (ctx.context as { betaInviteId?: string | null }).betaInviteId = decision.inviteId;
      } catch (error) {
        if (isAppError(error)) {
          throw new APIError("FORBIDDEN", { message: error.message });
        }
        throw error;
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") {
        return;
      }
      const user = ctx.context.newSession?.user;
      const inviteId = (ctx.context as { betaInviteId?: string | null }).betaInviteId ?? null;
      if (!user) {
        return;
      }
      try {
        await invites.consumeForUser({
          userId: user.id,
          email: user.email,
          inviteId,
        });
      } catch (error) {
        if (isAppError(error)) {
          throw new APIError("FORBIDDEN", { message: error.message });
        }
        throw error;
      }
    }),
  },
  plugins: [nextCookies()],
  trustedOrigins: [
    env.BETTER_AUTH_URL,
    "http://127.0.0.1:43147",
    "http://localhost:43147",
  ],
});
