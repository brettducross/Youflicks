import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** Owner-only: latest successful render metadata. Not a playback stream. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const services = getServices();
    const render = await services.renderService.getLatestSuccessful(user.id, projectId);
    return NextResponse.json({ render });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
