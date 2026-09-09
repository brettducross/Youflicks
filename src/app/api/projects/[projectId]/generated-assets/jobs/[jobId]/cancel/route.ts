import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; jobId: string }>;
};

/** Owner-only: cancel AI_ASSET. Already-READY pieces remain. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, jobId } = await context.params;
    const status = await getServices().assetService.cancelJob(user.id, projectId, jobId);
    return NextResponse.json(status);
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("asset.cancel_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
