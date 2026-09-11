import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { AI_CONSENT_POLICY_VERSION } from "@/server/beta/defaults";
import { inviteOnlyEnabled } from "@/server/beta/flags";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    inviteOnly: inviteOnlyEnabled(),
    emailDriver: env.EMAIL_DRIVER,
    consentPolicyVersion: env.AI_CONSENT_POLICY_VERSION || AI_CONSENT_POLICY_VERSION,
  });
}
