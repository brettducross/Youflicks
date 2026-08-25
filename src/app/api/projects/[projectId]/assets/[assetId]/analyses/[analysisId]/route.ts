import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string; analysisId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, assetId, analysisId } = await context.params;
    const analysis = await getServices().analysis.getForAsset(
      user.id,
      projectId,
      assetId,
      analysisId,
    );
    return NextResponse.json({ analysis });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("analysis.get_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
