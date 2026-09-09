import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string; movieId: string }>;
};

/** Owner-only: list publications + canExport / canShareLink honesty. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { projectId, movieId } = await context.params;
    const services = getServices();
    const [publications, availability, presentation] = await Promise.all([
      services.publicationService.list(user.id, projectId, movieId),
      services.publicationService.getAvailability(user.id, projectId, movieId),
      services.presentation.forUser(user.id, projectId),
    ]);
    return NextResponse.json({
      publications,
      ...availability,
      watermarkRequired: presentation.watermarkRequired,
      adsEnabled: presentation.adsEnabled,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
