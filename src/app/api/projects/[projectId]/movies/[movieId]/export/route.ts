import { Readable } from "node:stream";
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

/** Owner-only: explicit Export. 200 attachment + Publication, or 202 PUBLISH. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, movieId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { async?: boolean };
    const services = getServices();
    const result = await services.publicationService.exportDownload(user.id, projectId, movieId, {
      async: body.async,
    });
    if (isPublicationAccepted(result)) {
      after(() => {
        void services.publicationWorker.drain();
      });
      return NextResponse.json(result, { status: 202 });
    }

    const webStream = Readable.toWeb(result.stream.stream) as unknown as BodyInit;
    const headers = new Headers({
      "Content-Type": result.mimeType,
      "Content-Length": String(result.stream.contentLength),
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
      "X-YouFlicks-Publication-Id": result.publication.id,
      "X-YouFlicks-Publication-Status": result.publication.status,
    });
    return new NextResponse(webStream, { status: 200, headers });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("publication.export_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
