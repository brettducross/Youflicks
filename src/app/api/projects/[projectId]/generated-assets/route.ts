import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** Owner-only: list GeneratedAssets or latest READY fulfillments. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const latest = new URL(request.url).searchParams.get("latest") === "1";
    const services = getServices();
    const assets = latest
      ? await services.assetService.getLatestFulfillments(user.id, projectId)
      : await services.assetService.listAssets(user.id, projectId);
    return NextResponse.json({ assets });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
