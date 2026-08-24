import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, assetId } = await context.params;
    await getServices().media.remove(user.id, projectId, assetId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("media.remove_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
