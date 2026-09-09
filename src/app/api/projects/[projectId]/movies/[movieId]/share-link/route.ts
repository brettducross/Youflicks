import { after } from "next/server";
import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";
import { isPublicationAccepted } from "@/server/services/publication";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; movieId: string }>;
};

/** Owner-only: explicit Create share link. 200 { publication, shareUrl } or 202. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, movieId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      expiresAt?: string;
      async?: boolean;
    };
    const services = getServices();
    const result = await services.publicationService.createShareLink(user.id, projectId, movieId, {
      expiresAt: body.expiresAt,
      async: body.async,
    });
    if (isPublicationAccepted(result)) {
      after(() => {
        void services.publicationWorker.drain();
      });
      return NextResponse.json(result, { status: 202 });
    }
    return NextResponse.json({
      publication: result.publication,
      shareUrl: result.shareUrl,
      token: result.token,
    });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("publication.share_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
