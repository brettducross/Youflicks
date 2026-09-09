import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { sessionId?: string };
    if (!body.sessionId) {
      return NextResponse.json(
        { error: { code: "PLAYBACK_SESSION_INVALID", message: "That watch session is not valid." } },
        { status: 403 },
      );
    }
    const status = await getServices().playbackService.closeShare(body.sessionId);
    return NextResponse.json({ status });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
