import { after } from "next/server";
import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { isGeneratedAssetKind } from "@/server/assets/kinds";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** Owner-only: enqueue AI_ASSET. Does not run generation inline. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      roles?: Array<{
        role?: string;
        storySceneId?: string;
        kind?: string;
        reason?: string;
        sourceMediaAssetId?: string;
      }>;
    };
    const roles = Array.isArray(body.roles)
      ? body.roles
          .filter((item) => typeof item.role === "string" && item.role.length > 0)
          .map((item) => ({
            role: item.role as string,
            storySceneId: item.storySceneId,
            kind: item.kind && isGeneratedAssetKind(item.kind) ? item.kind : undefined,
            reason: item.reason,
            sourceMediaAssetId: item.sourceMediaAssetId,
          }))
      : undefined;
    const services = getServices();
    const queued = await services.assetService.requestGenerate(user.id, projectId, { roles });
    after(() => {
      void services.assetWorker.drain();
    });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("asset.enqueue_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** Owner-only: per-capability availability honesty (production vs local). */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const services = getServices();
    await services.projects.getForUser(user.id, projectId);
    return NextResponse.json(services.assetService.getAvailability());
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
