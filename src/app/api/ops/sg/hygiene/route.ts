import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { opsBearerAuthorized } from "@/server/ops/authorize";
import { prisma } from "@/server/db";
import { PrismaAiVideoBudget } from "@/server/sg/ai-video-budget";
import { OpsHygieneError, readSweepAges, runOpsHygiene } from "@/server/sg/ops-hygiene";

export const runtime = "nodejs";

/**
 * One ops hygiene job: aged UNRECONCILED sweep, stale RESERVED sweep,
 * and AI_VIDEO_SECONDS backfill. 404 without BETA_OPS_SECRET.
 */
export async function POST(request: Request) {
  if (!opsBearerAuthorized(request.headers.get("authorization"), env.BETA_OPS_SECRET)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  try {
    const ages = readSweepAges();
    const report = await runOpsHygiene(prisma, new PrismaAiVideoBudget(prisma), ages);
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof OpsHygieneError) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: error.message } }, { status: 400 });
    }
    logger.error("sg.ops_hygiene_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Ops hygiene failed." } }, { status: 500 });
  }
}
