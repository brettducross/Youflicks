import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";
import { toErrorResponse } from "@/lib/errors";
import { getServices } from "@/server/services/container";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const providers = getServices().providers.list().map((adapter) => {
      const health = adapter.health();
      return {
        providerKey: health.providerKey,
        configured: health.configured,
        enabled: health.enabled,
        available: health.available,
        capabilities: [...health.capabilities],
      };
    });
    return NextResponse.json({
      ok: true,
      service: "youflicks",
      database: "connected",
      analysis: {
        preferredProviderKey: env.ANALYSIS_PROVIDER ?? null,
        providers,
      },
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
