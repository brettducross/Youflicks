import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const services = getServices();
    const [intent, brief] = await Promise.all([
      services.intent.getForProject(user.id, projectId),
      services.intent.resolveBrief(user.id, projectId),
    ]);
    return NextResponse.json({ intent, effective: brief.effective });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("intent.read_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const payload = await request.json();
    const intent = await getServices().intent.upsert(user.id, projectId, payload);
    const brief = await getServices().intent.resolveBrief(user.id, projectId);
    return NextResponse.json({ intent, effective: brief.effective });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("intent.update_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
