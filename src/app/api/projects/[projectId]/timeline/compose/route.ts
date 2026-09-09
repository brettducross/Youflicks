import { after } from "next/server";
import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** Owner-only: enqueue AI_TIMELINE. Does not run timeline composition inline. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const services = getServices();
    const queued = await services.timelineService.requestCompose(user.id, projectId);
    after(() => {
      void services.timelineWorker.drain();
    });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("timeline.enqueue_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** Owner-only: timeline availability honesty (production vs local). */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const services = getServices();
    await services.projects.getForUser(user.id, projectId);
    return NextResponse.json(services.timelineService.getAvailability());
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
