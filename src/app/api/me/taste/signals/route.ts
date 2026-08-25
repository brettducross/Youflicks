import { NextResponse } from "next/server";
import { isAppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { TasteOrigin, type TasteOriginValue } from "@/server/domain/personalization";
import { requireApiUser } from "@/server/auth/api";
import { getServices } from "@/server/services/container";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const payload = (await request.json()) as {
      kind?: string;
      origin?: TasteOriginValue;
      payload?: Record<string, unknown> | null;
    };
    const signal = await getServices().taste.recordSignal(user.id, user.id, {
      kind: payload.kind ?? "",
      origin: payload.origin === TasteOrigin.INFERRED ? TasteOrigin.INFERRED : TasteOrigin.EXPLICIT,
      payload: payload.payload ?? null,
    });
    return NextResponse.json({ signal }, { status: 201 });
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("taste.signal_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
