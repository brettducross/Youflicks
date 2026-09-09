import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * Owner-only Timeline reads.
 * GET without query → latest READY cut (or null).
 * GET ?all=1 → all versions (newest first).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const services = getServices();
    const all = new URL(request.url).searchParams.get("all") === "1";
    if (all) {
      const timelines = await services.timelineService.listTimelines(user.id, projectId);
      return NextResponse.json({ timelines });
    }
    const timeline = await services.timelineService.getLatestReady(user.id, projectId);
    return NextResponse.json({ timeline });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
