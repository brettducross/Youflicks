import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; jobId: string }>;
};

/** Owner-only: AI_DIRECT job status (queued / running / succeeded / failed). */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, jobId } = await context.params;
    const services = getServices();
    const status = await services.directorService.getJobStatus(user.id, projectId, jobId);
    return NextResponse.json(status);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
