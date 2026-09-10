import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** Owner-only: library list + canKeep honesty. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
    const services = getServices();
    const [movies, availability, presentation] = await Promise.all([
      services.movieService.list(user.id, projectId, { includeArchived }),
      services.movieService.getAvailability(user.id, projectId),
      services.presentation.forUser(user.id, projectId),
    ]);
    return NextResponse.json({
      movies,
      ...availability,
      watermarkRequired: presentation.watermarkRequired,
      adsEnabled: presentation.adsEnabled,
      ads: presentation.ads.filter((surface) => surface.key === "LIBRARY_BANNER"),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
