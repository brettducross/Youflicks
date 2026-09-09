import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

/** SHARE_LINK recipient: title + expiry. No project APIs. */
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        { error: { code: "PUBLICATION_TOKEN_INVALID", message: "That share link is not valid." } },
        { status: 403 },
      );
    }
    const services = getServices();
    const grant = await services.publicationService.verifyShareToken(token);
    return NextResponse.json(services.publicationService.previewShare(grant));
  } catch (error) {
    if (!isAppError(error)) {
      const { status, body } = toErrorResponse(error);
      return NextResponse.json(body, { status });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
