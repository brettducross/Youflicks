import { after } from "next/server";
import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, assetId } = await context.params;
    const services = getServices();
    const queued = await services.analysis.requestAnalysis(user.id, projectId, assetId);
    after(() => {
      void services.analysisWorker.drain();
    });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("analysis.enqueue_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
