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

/** Owner-only: enqueue RENDER. Does not run render inline. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { outputProfile?: string };
    const services = getServices();
    const queued = await services.renderService.requestRender(user.id, projectId, {
      outputProfile: body.outputProfile,
    });
    after(() => {
      void services.renderWorker.drain();
    });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("render.enqueue_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** Owner-only: render availability honesty (production vs local). */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const services = getServices();
    await services.projects.getForUser(user.id, projectId);
    return NextResponse.json(services.renderService.getAvailability());
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
