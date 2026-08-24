import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const assets = await getServices().media.listForProject(user.id, projectId);
    return NextResponse.json({ assets });
  } catch (error) {
    return jsonError(error, "media.list_failed");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const contentLength = Number(request.headers.get("content-length"));
    const multipartCeiling = env.MEDIA_MAX_VIDEO_BYTES + 1024 * 1024;
    if (Number.isFinite(contentLength) && contentLength > multipartCeiling) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION",
            message: `Files must be ${Math.round(env.MEDIA_MAX_VIDEO_BYTES / (1024 * 1024))} MB or smaller.`,
          },
        },
        { status: 413 },
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "Choose a photo or video to ingest." } },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await getServices().media.ingest(user.id, projectId, {
      filename: file.name,
      bytes,
    });
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return jsonError(error, "media.ingest_failed");
  }
}

function jsonError(error: unknown, event: string) {
  if (!isAppError(error)) {
    logger.error(event, { error: error instanceof Error ? error.message : "unknown" });
  }
  const { status, body } = toErrorResponse(error);
  return NextResponse.json(body, { status });
}
