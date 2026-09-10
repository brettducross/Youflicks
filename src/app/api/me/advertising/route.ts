import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { allowlistedHttpsLinkUrl } from "@/server/advertising/link-url";
import { IN_MOVIE_SURFACE } from "@/server/advertising/types";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

/** Commercial surfaces only. Never serves in-movie ads. */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const surface = new URL(request.url).searchParams.get("surface") ?? undefined;
    if (surface === IN_MOVIE_SURFACE) {
      return NextResponse.json({
        adsEnabled: false,
        surfaces: [],
        honesty: await getServices().advertising.adsHonesty(user.id),
      });
    }
    const services = getServices();
    const [surfaces, honesty] = await Promise.all([
      services.advertising.eligibleSurfaces(user.id, { surface }),
      services.advertising.adsHonesty(user.id),
    ]);
    return NextResponse.json({
      adsEnabled: honesty.adsEnabled,
      surfaces,
      honesty,
    });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("advertising.read_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const payload = (await request.json().catch(() => ({}))) as {
      surface?: string;
      kind?: "impression" | "click";
      destinationUrl?: string | null;
    };
    const surface = payload.surface;
    if (!surface || surface === IN_MOVIE_SURFACE) {
      return NextResponse.json({ recorded: false });
    }
    const advertising = getServices().advertising;
    if (payload.kind === "click") {
      if (
        payload.destinationUrl != null &&
        !allowlistedHttpsLinkUrl(payload.destinationUrl)
      ) {
        return NextResponse.json({ recorded: false });
      }
      await advertising.recordClick(user.id, surface, payload.destinationUrl);
    } else {
      await advertising.recordImpression(user.id, surface);
    }
    return NextResponse.json({ recorded: true });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("advertising.record_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
