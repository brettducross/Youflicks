import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; publicationId: string }>;
};

/** Owner-only: revoke a SHARE_LINK. Subsequent token verify fails. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, publicationId } = await context.params;
    const publication = await getServices().publicationService.revoke(
      user.id,
      projectId,
      publicationId,
    );
    return NextResponse.json({ publication });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("publication.revoke_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
