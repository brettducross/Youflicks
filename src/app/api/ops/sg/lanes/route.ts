import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/server/db";
import { readLaneScopeDayRollups } from "@/server/sg/lane-meter-rollup";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = env.BETA_OPS_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  const rows = await readLaneScopeDayRollups(prisma);
  return NextResponse.json({ rows });
}
