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
      startMs?: number;
      surface?: "web" | "native";
    };
    const session = await getServices().playbackService.open(user.id, projectId, {
      renderJobId: body.renderJobId,
      startMs: body.startMs,
      surface: body.surface,
    });
    return NextResponse.json({ session });
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
