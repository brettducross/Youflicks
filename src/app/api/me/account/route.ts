import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

/** Session honesty: emailVerified + canGenerate + free-tier presentation flags. No prices. */
export async function GET() {
  try {
    const user = await requireApiUser();
    const services = getServices();
    const [gate, entitlementSummary, consentAccepted] = await Promise.all([
      services.entitlements.getPlatformGate(user.id),
      services.entitlements.getEntitlementSummary(user.id),
      services.consents.hasAccepted(user.id),
    ]);
    return NextResponse.json({
      emailVerified: gate.emailVerified,
      canGenerate: gate.canGenerate,
      denyCode: gate.denyCode,
      entitlementSummary,
      aiConsent: {
        policyVersion: services.consents.currentPolicyVersion(),
        accepted: consentAccepted,
      },
    });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("account.read_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE() {
  try {
    const user = await requireApiUser();
    const result = await getServices().wipe.deleteAccount(user.id);
    return NextResponse.json(result);
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("wipe.account_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** Resend the Better Auth verification email for the signed-in user. */
export async function POST() {
  try {
    const user = await requireApiUser();
    const result = await getServices().accountLifecycle.requestVerificationEmail(user.id);
    return NextResponse.json(result);
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("account.verify_resend_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
