import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

function parseRange(header: string | null, size: number) {
  if (!header || !header.startsWith("bytes=")) {
    return null;
  }
  const [startRaw, endRaw] = header.replace("bytes=", "").split("-");
  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, assetId } = await context.params;
    const variant =
      new URL(request.url).searchParams.get("variant") === "preview" ? "preview" : "original";
    const file = await getServices().media.openFile(user.id, projectId, assetId, variant);
    const range = parseRange(request.headers.get("range"), file.stream.byteSize);
    const streamed = range
      ? await (async () => {
          file.stream.stream.destroy();
          return getServices().media.openFile(user.id, projectId, assetId, variant, range);
        })()
      : file;

    const webStream = Readable.toWeb(streamed.stream.stream) as unknown as BodyInit;
    const headers = new Headers({
      "Content-Type": streamed.mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${streamed.filename.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(streamed.filename)}`,
      "Content-Length": String(streamed.stream.contentLength),
    });

    if (streamed.stream.range) {
      headers.set(
        "Content-Range",
        `bytes ${streamed.stream.range.start}-${streamed.stream.range.end}/${streamed.stream.byteSize}`,
      );
      return new NextResponse(webStream, { status: 206, headers });
    }

    return new NextResponse(webStream, { status: 200, headers });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("media.file_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
