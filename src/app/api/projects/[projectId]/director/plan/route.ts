import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * Owner-only CreativePlan reads.
 * GET without query → latest READY plan (or null).
 * GET ?all=1 → all versions (newest first).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const services = getServices();
    const all = new URL(request.url).searchParams.get("all") === "1";
    if (all) {
      const plans = await services.directorService.listPlans(user.id, projectId);
      return NextResponse.json({ plans });
    }
    const plan = await services.directorService.getLatestReady(user.id, projectId);
    return NextResponse.json({ plan });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
