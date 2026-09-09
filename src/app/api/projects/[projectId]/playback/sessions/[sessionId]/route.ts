import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; sessionId: string }>;
};

/** Owner-only: ephemeral session status. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, sessionId } = await context.params;
    const status = await getServices().playbackService.getStatus(
      user.id,
      projectId,
      decodeURIComponent(sessionId),
    );
    return NextResponse.json({ status });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
