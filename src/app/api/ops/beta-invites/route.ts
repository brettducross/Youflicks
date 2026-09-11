import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

function authorizeOps(request: Request) {
  const secret = env.BETA_OPS_SECRET?.trim();
  if (!secret) {
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorizeOps(request)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  try {
    const body = (await request.json()) as { email?: string; code?: boolean; note?: string };
    const invites = getServices().invites;
    if (body.code) {
      const minted = await invites.mintCode({ email: body.email, note: body.note });
      return NextResponse.json(minted, { status: 201 });
    }
    if (!body.email) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "email is required for an allowlist invite." } },
        { status: 400 },
      );
    }
    const minted = await invites.mintAllowlistEmail(body.email, body.note);
    return NextResponse.json(minted, { status: 201 });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("beta.invite_mint_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
