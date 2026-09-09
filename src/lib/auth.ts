import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { env } from "@/lib/env";
import { getVerificationEmailAdapter } from "@/server/adapters/email/log-verification-email";
import { prisma } from "@/server/db";

const verificationEmail = getVerificationEmailAdapter();

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
    sendOnSignUp: true,
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
  plugins: [nextCookies()],
  trustedOrigins: [
    env.BETTER_AUTH_URL,
    "http://127.0.0.1:43147",
    "http://localhost:43147",
  ],
});
