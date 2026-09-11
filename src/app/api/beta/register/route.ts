import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
      inviteCode?: string;
    };
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    const inviteCode = body.inviteCode?.trim();
    if (!name || !email || password.length < 8) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION",
            message: "Name, email, and an 8-character password are required.",
          },
        },
        { status: 400 },
      );
    }

    const invites = getServices().invites;
    const decision = await invites.assertCanRegister({ email, inviteCode });
    invites.rememberPending(email, decision);
    try {
      const result = await auth.api.signUpEmail({
        body: { name, email, password },
      });
      await invites.consumeForUser({
        userId: result.user.id,
        email,
        inviteId: decision.inviteId,
      });
      return NextResponse.json({ user: result.user }, { status: 201 });
    } finally {
      invites.clearPending(email);
    }
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("beta.register_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
