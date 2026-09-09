import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; sessionId: string }>;
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

function streamHeaders(
  mimeType: string,
  contentLength: number,
  range?: { start: number; end: number; byteSize: number },
) {
  const headers = new Headers({
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline; filename=\"movie.mp4\"",
    "Content-Length": String(contentLength),
  });
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${range.byteSize}`);
  }
  return headers;
}

/** Owner-only ranged stream of a SUCCEEDED render. Session must be open. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, sessionId } = await context.params;
    const decodedSessionId = decodeURIComponent(sessionId);
    const file = await getServices().playbackService.openStream(user.id, projectId, decodedSessionId);
    const range = parseRange(request.headers.get("range"), file.stream.byteSize);
    const streamed = range
      ? await (async () => {
          file.stream.stream.destroy();
          return getServices().playbackService.openStream(user.id, projectId, decodedSessionId, range);
        })()
      : file;

    const webStream = Readable.toWeb(streamed.stream.stream) as unknown as BodyInit;
    const headers = streamHeaders(
      streamed.mimeType,
      streamed.stream.contentLength,
      streamed.stream.range
        ? {
            start: streamed.stream.range.start,
            end: streamed.stream.range.end,
            byteSize: streamed.stream.byteSize,
          }
        : undefined,
    );

    if (streamed.stream.range) {
      return new NextResponse(webStream, { status: 206, headers });
    }
    return new NextResponse(webStream, { status: 200, headers });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("playback.stream_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function HEAD(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, sessionId } = await context.params;
    const decodedSessionId = decodeURIComponent(sessionId);
    const file = await getServices().playbackService.openStream(user.id, projectId, decodedSessionId);
    file.stream.stream.destroy();
    const range = parseRange(request.headers.get("range"), file.stream.byteSize);
    const headers = streamHeaders(
      file.mimeType,
      range ? range.end - range.start + 1 : file.stream.byteSize,
      range ? { start: range.start, end: range.end, byteSize: file.stream.byteSize } : undefined,
    );
    return new NextResponse(null, { status: range ? 206 : 200, headers });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
