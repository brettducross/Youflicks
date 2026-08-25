import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    const preferences = await getServices().taste.getSponsorshipPreferences(user.id, user.id);
    return NextResponse.json({ preferences });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("sponsorship.prefs_read_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const payload = (await request.json()) as Record<string, boolean>;
    const preferences = await getServices().taste.updateSponsorshipPreferences(user.id, user.id, {
      allowSponsorCredits: payload.allowSponsorCredits,
      allowSponsoredEndCard: payload.allowSponsoredEndCard,
      allowVideoAds: payload.allowVideoAds,
      allowPersonalizedSponsoring: payload.allowPersonalizedSponsoring,
    });
    return NextResponse.json({ preferences });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("sponsorship.prefs_update_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
