import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    const consents = getServices().consents;
    return NextResponse.json({
      policyVersion: consents.currentPolicyVersion(),
      accepted: await consents.hasAccepted(user.id),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST() {
  try {
    const user = await requireApiUser();
    const accepted = await getServices().consents.accept(user.id);
    return NextResponse.json(accepted);
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("consent.accept_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
