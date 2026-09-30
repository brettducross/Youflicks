import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { opsBearerAuthorized } from "@/server/ops/authorize";
import { prisma } from "@/server/db";
import { readLaneScopeDayRollups, readOpenExposure } from "@/server/sg/lane-meter-rollup";
import { readReconciliationFlags } from "@/server/sg/ops-hygiene";
import { OpsQueryError, parseRollupDays } from "@/server/sg/ops-window";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!opsBearerAuthorized(request.headers.get("authorization"), env.BETA_OPS_SECRET)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  let days: number;
  try {
    days = parseRollupDays(new URL(request.url).searchParams.get("days"));
  } catch (error) {
    const message = error instanceof OpsQueryError ? error.message : "Invalid days.";
    return NextResponse.json({ error: { code: "BAD_REQUEST", message } }, { status: 400 });
  }
  const [rolled, openExposure, reconciliationFlags] = await Promise.all([
    readLaneScopeDayRollups(prisma, days),
    readOpenExposure(prisma),
    readReconciliationFlags(prisma),
  ]);
  return NextResponse.json({
    rows: rolled.rows,
    days: rolled.days,
    since: rolled.since.toISOString(),
    openExposure,
    reconciliationFlags,
  });
}
