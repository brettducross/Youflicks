import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";
import { toErrorResponse } from "@/lib/errors";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      service: "youflicks",
      database: "connected",
    });
  } catch (error) {
    logger.error("health.check_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(
      { ok: false, service: "youflicks", ...body },
      { status },
    );
  }
}
