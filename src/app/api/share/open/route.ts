import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

/** SHARE_LINK recipient: open a watch-only session. No project membership. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      shareToken?: string;
      startMs?: number;
    };
    const token = body.shareToken ?? body.token;
    if (!token) {
      return NextResponse.json(
        { error: { code: "PUBLICATION_TOKEN_INVALID", message: "That share link is not valid." } },
        { status: 403 },
      );
    }
    const services = getServices();
    const grant = await services.publicationService.verifyShareToken(token);
    const session = await services.playbackService.openWithShareToken(token, body.startMs);
    return NextResponse.json({
      session,
      title: grant.title,
      expiresAt: grant.expiresAt,
      watchOnly: true,
    });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("publication.share_open_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
