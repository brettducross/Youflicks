import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; movieId: string }>;
};

/** Owner-only: restore an archived film to READY. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, movieId } = await context.params;
    const movie = await getServices().movieService.unarchive(user.id, projectId, movieId);
    return NextResponse.json({ movie });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("movie.unarchive_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
