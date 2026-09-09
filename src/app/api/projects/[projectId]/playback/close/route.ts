import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** Owner-only: close an ephemeral watch session. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { sessionId?: string };
    if (!body.sessionId) {
      return NextResponse.json(
        { error: { code: "PLAYBACK_INPUT_INVALID", message: "sessionId is required." } },
        { status: 422 },
      );
    }
    const status = await getServices().playbackService.close(user.id, projectId, body.sessionId);
    return NextResponse.json({ status });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("playback.close_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
