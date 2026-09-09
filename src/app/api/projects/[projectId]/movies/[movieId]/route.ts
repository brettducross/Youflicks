import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; movieId: string }>;
};

/** Owner-only: one library film. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, movieId } = await context.params;
    const movie = await getServices().movieService.get(user.id, projectId, movieId);
    return NextResponse.json({ movie });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
