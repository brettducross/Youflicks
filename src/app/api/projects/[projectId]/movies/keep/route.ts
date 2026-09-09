import { after } from "next/server";
import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { isMovieKeepAccepted } from "@/server/services/movie";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** Owner-only: explicit Keep. Sync 200 or async LIBRARY_KEEP 202. Never auto-keep. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      renderJobId?: string;
      title?: string;
      async?: boolean;
    };
    const services = getServices();
    const result = await services.movieService.keep(user.id, projectId, {
      renderJobId: body.renderJobId,
      title: body.title,
      async: body.async,
    });
    if (isMovieKeepAccepted(result)) {
      after(() => {
        void services.movieWorker.drain();
      });
      return NextResponse.json(result, { status: 202 });
    }
    return NextResponse.json({ movie: result });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("movie.keep_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
