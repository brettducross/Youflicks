import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * Owner-only StoryStructure reads.
 * GET without query → latest READY story (or null).
 * GET ?all=1 → all versions (newest first).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const services = getServices();
    const all = new URL(request.url).searchParams.get("all") === "1";
    if (all) {
      const stories = await services.storyService.listStories(user.id, projectId);
      return NextResponse.json({ stories });
    }
    const story = await services.storyService.getLatestReady(user.id, projectId);
    return NextResponse.json({ story });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
