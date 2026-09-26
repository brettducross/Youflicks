import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/server/db";
import { readLaneScopeDayRollups } from "@/server/sg/lane-meter-rollup";
import { OpsQueryError, parseRollupDays } from "@/server/sg/ops-window";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = env.BETA_OPS_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  let days: number;
  try {
    days = parseRollupDays(new URL(request.url).searchParams.get("days"));
  } catch (error) {
    const message = error instanceof OpsQueryError ? error.message : "Invalid days.";
    return NextResponse.json({ error: { code: "BAD_REQUEST", message } }, { status: 400 });
  }
  const rolled = await readLaneScopeDayRollups(prisma, days);
  return NextResponse.json({
    rows: rolled.rows,
    days: rolled.days,
    since: rolled.since.toISOString(),
  });
}
