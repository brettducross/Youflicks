import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    const profile = await getServices().taste.getForUser(user.id, user.id);
    return NextResponse.json({ profile });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("taste.read_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const payload = (await request.json()) as {
      notes?: string | null;
      preferences?: Array<{ dimension: string; value: string }>;
    };
    const profile = await getServices().taste.replacePreferences(user.id, user.id, {
      notes: payload.notes,
      preferences: payload.preferences ?? [],
    });
    return NextResponse.json({ profile });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("taste.update_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
