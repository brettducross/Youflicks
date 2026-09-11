import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/server/db";
import { GATEWAY_SPEND_LEDGER_ID } from "@/server/beta/defaults";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = env.BETA_OPS_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  const row = await prisma.gatewaySpendLedger.findUnique({
    where: { id: GATEWAY_SPEND_LEDGER_ID },
  });
  return NextResponse.json({
    ledgerId: GATEWAY_SPEND_LEDGER_ID,
    jobsAccepted: row?.jobsAccepted ?? 0,
    spendUsd: row?.spendUsd ?? 0,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  });
}
