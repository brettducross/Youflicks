import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** Owner-only: open an ephemeral watch session for a SUCCEEDED render. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      renderJobId?: string;
      finishedMovieId?: string;
      startMs?: number;
      surface?: "web" | "native";
    };
    const services = getServices();
    const session = await services.playbackService.open(user.id, projectId, {
      renderJobId: body.renderJobId,
      finishedMovieId: body.finishedMovieId,
      startMs: body.startMs,
      surface: body.surface,
    });
    const presentation = await services.presentation.forUser(user.id, projectId);
    return NextResponse.json({
      session,
      presentation: {
        watermarkRequired: presentation.watermarkRequired,
        watermark: presentation.watermark,
        ads: presentation.ads.filter((surface) => surface.key === "POST_FILM"),
      },
    });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("playback.open_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
